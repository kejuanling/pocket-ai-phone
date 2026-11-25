
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
# [位置:tests/ui/test_pages_time_tz.py] [记忆池 / 工具集：时间必须是本地时间]
# [需求:11-07「一起修了吧」——后端 memory-v2 / memory-review / relevant-preview / memory-summary / mcp-tool-overrides
#  给的时间都是 toISOString() 的 UTC，前端直接切字符串当墙上时间印，比北京时间少 8 小时、跨夜连日期都错]
# [注释时间 2026-11-07]
import json, subprocess, time, re, sys
from playwright.sync_api import sync_playwright

PORT = 8934
CWD = os.path.join(PROJECT_ROOT, 'workspace')
srv = subprocess.Popen(['python3', '-m', 'http.server', str(PORT), '--bind', '127.0.0.1'],
                       cwd=CWD, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
time.sleep(1)

UTC_NIGHT = '2026-11-06T20:12:44.283Z'   # 北京时间 2026-11-07 04:12（跨日）
UTC_DAY = '2026-11-06T11:05:00.000Z'     # 北京时间 2026-11-06 19:05

ENTRIES = {'items': [{'id': 'm1', 'kind': 'fact', 'text': '她怕黑', 'status': 'active', 'worth': 0.8,
                      'created_at': UTC_NIGHT, 'triggers': ['怕黑']}]}
QUEUE = {'items': [{'id': 'q1', 'created_at': UTC_NIGHT,
                    'candidate': {'kind': 'fact', 'text': '她喜欢布丁'},
                    'judge': {'worth': 0.7, 'volatility': 'low'}}]}
PREV = {'items': [{'time': UTC_NIGHT, 'query': '睡了吗', 'hits': [{'text': '她怕黑'}]}]}
SUMMARY = {'core_identity': [{'version': 3, 'at': UTC_NIGHT, 'text': '正文'}],
           'understanding': [{'version': 2, 'at': UTC_DAY, 'text': '正文2'}]}
TOOLS = {'ok': True,
         'servers': [{'id': 'ai-toolbox', 'name': '本机工具', 'tools': [
             {'name': 'todo_list', 'description': '读待办', 'enabled': True}]}],
         'history': [{'tool': 'todo_list', 'field': 'description', 'time': UTC_NIGHT, 'source': '手机'}]}


def handler(route):
    path = re.sub(r'^http://127\.0\.0\.1:%d' % PORT, '', route.request.url).split('?')[0]

    def ok(o):
        route.fulfill(status=200, content_type='application/json', body=json.dumps(o))

    if not path.startswith(('/v1/', '/heartbeat/', '/admin/')):
        return route.continue_()
    if path == '/heartbeat/admin/memory-v2/entries': return ok(ENTRIES)
    if path == '/heartbeat/admin/memory-review/queue': return ok(QUEUE)
    if path == '/heartbeat/admin/memory-v2/relevant-preview': return ok(PREV)
    if path == '/heartbeat/admin/memory-summary/history': return ok(SUMMARY)
    if path == '/heartbeat/admin/mcp/tool-overrides': return ok(TOOLS)
    if path == '/v1/sessions': return ok({'sessions': []})
    if path == '/v1/history': return ok({'items': []})
    if path == '/heartbeat/admin/session-names': return ok({'names': {}})
    if path == '/heartbeat/admin/session-archive': return ok({'archived': []})
    if path == '/heartbeat/admin/session-pins': return ok({'pins': []})
    if path == '/heartbeat/admin/wake-locked': return ok({'sessions': []})
    if path == '/heartbeat/admin/wake-event-sessions': return ok({'sessions': []})
    if path == '/heartbeat/admin/session-status': return ok({'status': {}})
    if path == '/heartbeat/admin/subagent-status': return ok({'status': {}})
    if path == '/heartbeat/admin/chat-settings': return ok({'ok': True, 'data': {'cfg': {}}})
    if path == '/heartbeat/admin/recent-tools': return ok({'items': []})
    if path == '/heartbeat/admin/push-events': return ok({'items': []})
    if path == '/heartbeat/admin/wake-receipts': return ok({'items': []})
    return ok({})


bad = []
def check(c, m):
    print(('PASS ' if c else 'FAIL ') + m)
    if not c:
        bad.append(m)


def fresh(b):
    """新开一个解锁后的页面"""
    ctx = b.new_context(viewport={'width': 390, 'height': 844}, device_scale_factor=2)
    page = ctx.new_page()
    page.route('**/*', handler)
    page.goto('http://127.0.0.1:%d/phone-new.html' % PORT)
    page.wait_for_timeout(2000)
    lk = page.locator('#lock').bounding_box()
    cx, cy = lk['x'] + lk['width'] / 2, lk['y'] + lk['height'] * 0.75
    page.mouse.move(cx, cy); page.mouse.down()
    for i in range(1, 13):
        page.mouse.move(cx, cy - 35 * i); page.wait_for_timeout(12)
    page.mouse.up()
    page.wait_for_timeout(1400)
    return ctx, page


def win_text(page, app):
    return page.locator('.win[data-win="%s"]' % app).inner_text()


with sync_playwright() as p:
    b = p.chromium.launch()

    # ---- 一、记忆池列表行的日期（mFrom.d → 列表 / 分组 / 详情共用）+ 待审候选 ----
    ctx, page = fresh(b)
    page.locator('#grid [data-app="mem"]').first.click()
    page.wait_for_timeout(2000)
    row_txt = page.locator('.win[data-win="mem"] #mmL').inner_text()
    print('记忆池列表:', row_txt.replace('\n', ' | '))
    check('11.07' in row_txt, '记忆池列表行日期 = 11.07（UTC 11-06T20:12 → 本地 11-07）')
    check('11.06' not in row_txt, '记忆池列表行不再显示 UTC 日期 11.06')
    check('11 月' in row_txt, '日期分组「11 月」仍正常')

    page.evaluate("() => PH.mem.review()")
    page.wait_for_timeout(1500)
    q_txt = win_text(page, 'mem')
    print('待审页时间行:', [l for l in q_txt.split('\n') if re.search(r'\d\d\.\d\d', l)])
    check('11.07 04:12' in q_txt, '待审候选时间 = 11.07 04:12')
    check('11.06 20:12' not in q_txt, '待审候选不再显示 UTC 原值 11.06 20:12')
    page.screenshot(path='/tmp/m2_queue.png')
    ctx.close()

    # ---- 二、相关注入预览 ----
    ctx, page = fresh(b)
    page.locator('#grid [data-app="mem"]').first.click()
    page.wait_for_timeout(1800)
    page.evaluate("() => PH.mem.set()")
    page.wait_for_timeout(1800)
    gos = page.locator('.win[data-win="mem"] [data-go]').evaluate_all(
        "els => els.map(e => e.getAttribute('data-go'))")
    print('设置页 data-go:', gos)
    page.evaluate("() => { const b=document.querySelector('.win[data-win=\"mem\"] [data-go=\"pv\"]'); if(b) b.click(); }")
    page.wait_for_timeout(1500)
    pv_txt = win_text(page, 'mem')
    print('注入预览页:', [l for l in pv_txt.split('\n') if '条命中' in l])
    check('11-07 04:12' in pv_txt, '相关注入预览时间 = 11-07 04:12')
    check('11-06 20:12' not in pv_txt, '注入预览不再显示 UTC 原值')
    page.screenshot(path='/tmp/m3_pv.png')
    ctx.close()

    # ---- 三、两块总结版本存档 ----
    ctx, page = fresh(b)
    page.locator('#grid [data-app="mem"]').first.click()
    page.wait_for_timeout(1800)
    page.evaluate("() => PH.mem.set()")
    page.wait_for_timeout(1800)
    page.evaluate("() => { const b=document.querySelector('.win[data-win=\"mem\"] [data-go=\"ver\"]'); if(b) b.click(); }")
    page.wait_for_timeout(2000)
    ver_txt = win_text(page, 'mem')
    print('版本存档页:', ver_txt.replace('\n', ' | ')[:300])
    check('11-07 04:12' in ver_txt, '两块总结版本时间 = 11-07 04:12')
    # 默认 tab 是 Core Identity，切到「长期理解」看第二版（seg 按钮 data-seg=1）
    page.evaluate("() => { const b=document.querySelector('.win[data-win=\"mem\"] [data-seg=\"1\"]'); if(b) b.click(); }")
    page.wait_for_timeout(1200)
    ver_txt2 = win_text(page, 'mem')
    print('长期理解 tab:', [l for l in ver_txt2.split('\n') if re.match(r'^\d\d-\d\d ', l)])
    check('11-06 19:05' in ver_txt2, '另一版时间 = 11-06 19:05（UTC 11:05 +8）')
    page.screenshot(path='/tmp/m4_ver.png')
    ctx.close()

    # ---- 四、工具集变更历史 ----
    ctx, page = fresh(b)
    page.locator('#grid [data-app="tools"]').first.click()
    page.wait_for_timeout(2500)
    print('工具集首屏:', win_text(page, 'tools')[:300].replace('\n', ' | '))
    page.screenshot(path='/tmp/m5_tools.png')
    page.evaluate("""() => {
      const w = document.querySelector('.win[data-win="tools"]');
      const b = w.querySelector('.mc-tool, .pg-r, .mc-srv');
      if (b) b.click();
    }""")
    page.wait_for_timeout(1500)
    t_txt = win_text(page, 'tools')
    print('工具集含 2026. 的行:', [l for l in t_txt.split('\n') if '2026.' in l])
    check('2026.11.07 04:12' in t_txt, '工具集变更历史时间 = 2026.11.07 04:12（UTC 20:12 → 本地 11-07）')
    page.screenshot(path='/tmp/m6_tools_hist.png')
    ctx.close()
    b.close()

srv.terminate()
print('BAD:', bad)
sys.exit(1 if bad else 0)
