
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
# [位置:tests/ui/test_export_time_tz.py] [会话导出 & 最近动静：时间必须是本地时间]
# [需求:11-07 报「会话导出的那个名字那行的时间不对」——/v1/history 与 /heartbeat/admin/recent-tools 都返回 UTC，
#  前端原来直接切字符串当墙上时间印，比北京时间少 8 小时（跨夜连日期都错）。本脚本在真浏览器里跑完整链路：解锁 → 会话列表 → 长按 → 导出 → 读下载文件]
# [注释时间 2026-11-07]
import json, subprocess, time, re
from playwright.sync_api import sync_playwright

PORT = 8933
CWD = os.path.join(PROJECT_ROOT, 'workspace')
srv = subprocess.Popen(['python3', '-m', 'http.server', str(PORT), '--bind', '127.0.0.1'],
                       cwd=CWD, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
time.sleep(1)

# 演示数据：UTC 时间，北京时间要跨日（20:12Z → 次日 04:12）
SESS = [{'id': 's_t0', 'name': '时区验证', 'real': 3, 'total': 3,
         'last_time': '2026-11-06T20:12:44.283Z', 'last_text': '晚点聊'}]
# u1/u2/u4/u3 的 content 仿真实落盘形态：时间缀拼在她消息末尾；u2 叠 [elapsed] 与新会话 <session> 指令；
# u4 是图片消息（时间缀后跟 [图片] 占位，剥完空行会堆）；u3 只有一条时间缀（应整条跳过）；
# a1 正文里写 <session> 字样，AI 消息不剥，验证不误伤。2026-11-07 导出剥系统标签用。
HIST = {'items': [
    {'id': 'u1', 'role': 'user', 'content': '晚上吃啥\n<current_time>Fri 26-11-06 19:30:00</current_time>', 'time': '2026-11-06T11:30:00.000Z'},
    {'id': 'a1', 'role': 'assistant', 'content': '随便你。<session> 这种标签是系统注入的。', 'time': '2026-11-06T20:12:44.283Z'},
    {'id': 'u2', 'role': 'user', 'content': '困了\n\n[elapsed:1h22min]\n<session>此为新会话，请设定会话标题，用 <title> 标签输出，不要解释，格式：<title>会话名</title></session>', 'time': '2026-11-06T20:15:00.000Z'},
    {'id': 'u4', 'role': 'user', 'content': '（眨眼）\n\n\n\n\n<current_time>Wed 26-08-26 23:49:32</current_time>\n[图片]', 'time': '2026-08-26T15:49:32.000Z'},
    {'id': 'u3', 'role': 'user', 'content': '\n<current_time>Sat 26-11-07 04:16:00</current_time>', 'time': '2026-11-06T20:16:00.000Z'},
], 'has_more': False}
TOOLS = {'items': [
    {'name': 'todo_list', 'time': '2026-11-06T20:12:44.283Z', 'hint': '读了待办'},
    {'name': 'diary_write', 'time': '2026-11-06T11:05:00.000Z', 'hint': '写入日记'},
]}


def handler(route):
    url = route.request.url
    path = re.sub(r'^http://127\.0\.0\.1:%d' % PORT, '', url).split('?')[0]

    def ok(o):
        route.fulfill(status=200, content_type='application/json', body=json.dumps(o))

    if not path.startswith(('/v1/', '/heartbeat/', '/admin/')):
        return route.continue_()
    if path == '/v1/sessions': return ok({'sessions': SESS})
    if path == '/v1/history': return ok(HIST)
    if path == '/v1/sessions/snapshot-stale-all': return ok({'ok': True, 'stale': {}})
    if path == '/heartbeat/admin/session-names': return ok({'names': {'s_t0': '时区验证'}})
    if path == '/heartbeat/admin/session-archive': return ok({'archived': []})
    if path == '/heartbeat/admin/session-pins': return ok({'pins': []})
    if path == '/heartbeat/admin/wake-locked': return ok({'sessions': []})
    if path == '/heartbeat/admin/wake-event-sessions': return ok({'sessions': []})
    if path == '/heartbeat/admin/session-status': return ok({'status': {}})
    if path == '/heartbeat/admin/subagent-status': return ok({'status': {}})
    if path == '/heartbeat/admin/chat-settings': return ok({'ok': True, 'data': {'cfg': {}}})
    if path == '/heartbeat/admin/recent-tools': return ok(TOOLS)
    if path == '/heartbeat/admin/push-events': return ok({'items': []})
    if path == '/heartbeat/admin/wake-receipts': return ok({'items': []})
    return ok({})


bad = []
def check(c, m):
    print(('PASS ' if c else 'FAIL ') + m)
    if not c:
        bad.append(m)


with sync_playwright() as p:
    b = p.chromium.launch()
    ctx = b.new_context(viewport={'width': 390, 'height': 844}, device_scale_factor=2, accept_downloads=True)
    page = ctx.new_page()
    page.route('**/*', handler)
    page.goto('http://127.0.0.1:%d/phone-new.html' % PORT)
    page.wait_for_timeout(2000)

    # 上滑解锁
    lk = page.locator('#lock').bounding_box()
    cx, cy = lk['x'] + lk['width'] / 2, lk['y'] + lk['height'] * 0.75
    page.mouse.move(cx, cy); page.mouse.down()
    for i in range(1, 13):
        page.mouse.move(cx, cy - 35 * i); page.wait_for_timeout(12)
    page.mouse.up()
    page.wait_for_timeout(1500)

    # ---- 一、最近动静（工具 tab）----
    page.evaluate("""() => { const t = document.querySelector('#hwTabs [data-t="tool"]'); if (t) t.click(); }""")
    page.wait_for_timeout(1000)
    tools_txt = page.locator('#hwA').inner_text()
    check('11-07 04:12' in tools_txt, '最近动静 todo_list 显示本地时间 11-07 04:12（UTC 20:12 +8 跨日）')
    check('11-06 19:05' in tools_txt, '最近动静 diary_write 显示本地时间 11-06 19:05')
    check('11-06 20:12' not in tools_txt, '最近动静不再出现 UTC 原值 11-06 20:12')

    # ---- 二、会话长按 → 导出 ----
    page.locator('[data-app="chats"]').first.click()
    page.wait_for_timeout(1800)
    rb = page.locator('.cs-it').first.bounding_box()
    page.mouse.move(rb['x'] + rb['width'] / 2, rb['y'] + rb['height'] / 2)
    page.mouse.down(); page.wait_for_timeout(600); page.mouse.up()
    page.wait_for_timeout(500)
    with page.expect_download(timeout=8000) as dl:
        page.locator('.cs-menu [data-a="export"]').click()
    out = '/tmp/test_export_time_tz.txt'
    dl.value.save_as(out)
    txt = open(out, encoding='utf-8').read()
    print('---- 导出内容 ----\n' + txt + '---- end ----')
    check('2026-11-07 04:12 · 谢意行' in txt, '导出：AI 那条是本地时间 2026-11-07 04:12')
    check('2026-11-06 19:30 · 涵' in txt, '导出：用户第一条是本地时间 2026-11-06 19:30')
    check('2026-11-07 04:15 · 涵' in txt, '导出：用户第二条是本地时间 2026-11-07 04:15')
    check('2026-11-06 20:12' not in txt and '2026-11-06 11:30' not in txt, '导出不再出现 UTC 原值')
    check('<current_time>' not in txt, '导出正文不再带 <current_time> 时间缀')
    check('此为新会话' not in txt, '导出剥掉新会话 <session> 建标题指令')
    check('[elapsed:' not in txt, '导出剥掉 [elapsed:…] 标记')
    check('随便你。<session> 这种标签是系统注入的' in txt, 'AI 消息里的标签字样原样保留（不误伤）')
    check('（眨眼）\n\n[图片]' in txt, '图片消息剥时间缀后连续空行压成一个空行')
    check(txt.count('\n\n---\n\n') == 3 and '2026-11-07 04:16' not in txt, '纯时间缀消息整条跳过（5 条数据导出 4 条）')
    # 回环：导出行必须仍能被导入端的 headerRe 认出（正则从真源码抽，不手抄）
    src = open(CWD + '/phone-chats.js', encoding='utf-8').read()
    hline = [l for l in src.split('\n') if 'var headerRe=' in l][0]
    raw = hline.split('headerRe=')[1].strip().rstrip(';').strip()   # 形如 /^(\d{4})...$/，去掉两侧斜杠
    hre = re.compile(raw[1:-1])
    heads = [l for l in txt.split('\n') if '·' in l]
    check(len(heads) == 4 and all(hre.match(h) for h in heads), '导出行全部仍能被导入端正则识别（回环不断）')

    ctx.close(); b.close()

srv.terminate()
print('BAD:', bad)
raise SystemExit(1 if bad else 0)
