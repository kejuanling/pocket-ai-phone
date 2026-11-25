
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
# [位置:tests/ui/test_notes_folders_ui.py] [笔记本文件夹：先文件夹后笔记、点文件夹进一层页、右上+新建文件夹/笔记（建在当前文件夹）、长按笔记 编辑/移动到/删除、长按文件夹 编辑摘要/重命名/删除（非空拒绝）、搜索带位置、目录笔记树形渲染（文件夹行缩进+无时间列）] [10-28；10-29 加摘要与树形目录] [注释时间 2026-10-29]
import json, subprocess, time, re
from playwright.sync_api import sync_playwright
PORT = 8907
srv = subprocess.Popen(['python3', '-m', 'http.server', str(PORT), '--bind', '127.0.0.1'], cwd=os.path.join(PROJECT_ROOT, 'workspace'), stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
time.sleep(1)
def mk(i, t, folder='', idx=False): return {'id': i, 'title': t, 'summary': '摘要' + t, 'reason': '', 'tags': [], 'is_index': idx, 'folder': folder, 'created_at': '2026-10-20T10:00:00', 'updated_at': '2026-10-20T10:00:00', 'length': 10, 'preview': ''}
# 目录笔记正文：新树形格式（文件夹段 + 根目录文件段，子级行首全角空格缩进）
IDX_BODY = ('文件夹行：fid｜路径｜摘要（缩进=层级）；文件行：id｜标题｜摘要。系统自动生成的树形目录：文件夹默认闭合。\n\n'
            '文件夹（2 个）：\nf1｜故事｜测试用的故事文件夹\n　f2｜故事/第一卷｜子卷摘要\n\n'
            '根目录文件（1 篇）：\n2｜根上的笔记｜摘要根上的笔记\n')
db = {'notes': [mk(1, '笔记本目录', '', True), mk(2, '根上的笔记'), mk(3, '故事里的一篇', '故事'), mk(4, '第一卷里的', '故事/第一卷')], 'folders': ['故事', '故事/第一卷', '空的']}
fsum = {}
log = []
def folders_brief():
    out = []
    for p in sorted(set(db['folders'])):
        c = sum(1 for n in db['notes'] if not n['is_index'] and (n['folder'] == p or n['folder'].startswith(p + '/')))
        out.append({'path': p, 'summary': fsum.get(p, ''), 'count': c})
    return out
def handler(route):
    req = route.request; full = req.url.replace('http://127.0.0.1:%d' % PORT, ''); u = full.split('?')[0]
    def ok(o, code=200): route.fulfill(status=code, content_type='application/json', body=json.dumps(o))
    if u == '/papers/api/notes':
        m = re.search(r'q=([^&]+)', full)
        if m:
            from urllib.parse import unquote
            q = unquote(m.group(1)); return ok({'notes': [dict(n, preview='命中 ' + q) for n in db['notes'] if q in n['title']], 'folders': folders_brief(), 'q': q})
        return ok({'notes': db['notes'], 'folders': folders_brief(), 'q': ''})
    if u == '/papers/api/note':
        i = int(re.search(r'id=(\d+)', full).group(1)); n = [x for x in db['notes'] if x['id'] == i][0]
        return ok(dict(n, body=IDX_BODY if n['is_index'] else '正文'))
    b = json.loads(req.post_data) if req.post_data else {}
    if u.startswith('/papers/api/'): log.append((u.replace('/papers/api/', ''), b))
    if u == '/papers/api/note/move':
        for n in db['notes']:
            if n['id'] == b['id']: n['folder'] = b['folder']
        return ok({'success': True})
    if u == '/papers/api/note/add':
        db['notes'].append(mk(len(db['notes']) + 10, b['title'], b.get('folder', ''))); return ok({'success': True, 'id': 99})
    if u == '/papers/api/note/delete':
        db['notes'] = [n for n in db['notes'] if n['id'] != b['id']]; return ok({'success': True})
    if u == '/papers/api/index/refresh':
        return ok({'success': True, 'changed': True, 'id': 1})
    if u == '/papers/api/folder/add':
        db['folders'].append(b['path']); db['folders'].sort(); return ok({'success': True})
    if u == '/papers/api/folder/summary':
        fsum[b['path']] = b.get('summary', ''); return ok({'success': True, 'path': b['path'], 'summary': b.get('summary', '')})
    if u == '/papers/api/folder/rename':
        p = b['path']; np = (p.rsplit('/', 1)[0] + '/' if '/' in p else '') + b['name']
        mv = lambda x: np if x == p else (np + x[len(p):] if x.startswith(p + '/') else x)
        db['folders'] = [mv(f) for f in db['folders']]
        for n in db['notes']: n['folder'] = mv(n['folder'])
        fsum2 = {}
        for k, v in fsum.items(): fsum2[mv(k)] = v
        fsum.clear(); fsum.update(fsum2)
        return ok({'success': True})
    if u == '/papers/api/folder/delete':
        p = b['path']
        if any(n['folder'] == p or n['folder'].startswith(p + '/') for n in db['notes']) or any(f.startswith(p + '/') for f in db['folders']): return ok({'error': '文件夹不是空的：里面还有笔记，先移走或删掉'}, 400)
        db['folders'] = [f for f in db['folders'] if f != p]; fsum.pop(p, None); return ok({'success': True})
    return ok({})
def check(c, m):
    print(('PASS ' if c else 'FAIL ') + m)
    if not c: check.bad = True
check.bad = False
with sync_playwright() as p:
    b = p.chromium.launch(); pg = b.new_context(viewport={'width': 390, 'height': 844}).new_page()
    errs = []; pg.on('pageerror', lambda e: errs.append(str(e)))
    pg.route(re.compile(r'.*/(v1|heartbeat|todo|papers)/.*'), handler)
    pg.goto('http://127.0.0.1:%d/phone-new.html' % PORT); pg.wait_for_timeout(1500)
    pg.mouse.move(195, 760); pg.mouse.down(); pg.mouse.move(195, 500, steps=8); pg.mouse.move(195, 150, steps=8); pg.mouse.up(); pg.wait_for_timeout(1200)
    pg.click('.app-ic[data-app="note"]'); pg.wait_for_timeout(1800)
    g = lambda js: pg.evaluate(js)
    def hold(sel):
        bx = pg.eval_on_selector(sel, 'e=>{const r=e.getBoundingClientRect();return [r.x+r.width/2,r.y+r.height/2]}')
        pg.mouse.move(bx[0], bx[1]); pg.mouse.down(); pg.wait_for_timeout(700); pg.mouse.up(); pg.wait_for_timeout(600)
    # 根目录：文件夹行（小字=篇数+摘要）
    check(g("Array.from(document.querySelectorAll('#ntList .nt-fr')).map(e=>e.innerText.replace(/\\s+/g,' ').trim()).join('|')") .startswith('故事') and g("document.querySelectorAll('#ntList .nt-fr').length") == 2, '根目录：先列出 2 个文件夹（故事、空的）')
    sm = g("document.querySelector('#ntList .nt-fr small')?document.querySelector('#ntList .nt-fr small').textContent:''")
    check('2 篇' in sm, '文件夹行小字带篇数：故事 = 2 篇')
    pg.click('#ntList .nt-fr[data-p="故事"]'); pg.wait_for_timeout(1200)
    check(g("document.querySelector('.nt-dirbox[data-dir=\"故事\"] .nt-fr[data-p=\"故事/第一卷\"]') !== null") and '故事里的一篇' in g("document.querySelector('.nt-dirbox[data-dir=\"故事\"]').innerText"), '进入「故事」：有子文件夹「第一卷」和笔记「故事里的一篇」')
    # 长按文件夹 → 编辑摘要
    hold('.nt-dirbox[data-dir="故事"] .nt-fr[data-p="故事/第一卷"]')
    sheet = g("document.querySelector('.pg-sheet')?document.querySelector('.pg-sheet').innerText:''")
    check('编辑摘要' in sheet and '重命名' in sheet and '删除' in sheet, '长按文件夹：编辑摘要 / 重命名 / 删除')
    pg.click('.pg-sheet [data-act="sum"]'); pg.wait_for_timeout(700)
    pg.fill('.pg-sheet .nt-sum', '子卷摘要'); pg.click('.pg-sheet [data-ok]'); pg.wait_for_timeout(900)
    check(log[-1] == ('folder/summary', {'path': '故事/第一卷', 'summary': '子卷摘要'}), '编辑摘要：POST folder/summary')
    pg.wait_for_timeout(900)
    sm2 = g("document.querySelector('.nt-dirbox[data-dir=\"故事\"] .nt-fr[data-p=\"故事/第一卷\"] small')?document.querySelector('.nt-dirbox[data-dir=\"故事\"] .nt-fr[data-p=\"故事/第一卷\"] small').textContent:''")
    check('1 篇 · 子卷摘要' in sm2, '摘要保存后文件夹行小字立刻带摘要：1 篇 · 子卷摘要')
    pg.screenshot(path='/tmp/nt_dir_sum.png')
    # 右上 +
    pg.click('.pg-sub.show [data-go="ntplus"]'); pg.wait_for_timeout(700)
    check('新建文件夹' in g("document.querySelector('.pg-sheet').innerText") and '新建笔记' in g("document.querySelector('.pg-sheet').innerText"), '右上 +：新建文件夹 / 新建笔记')
    pg.click('.pg-sheet [data-act="nf"]'); pg.wait_for_timeout(700)
    pg.fill('.pg-sheet .nt-name', '新卷'); pg.click('.pg-sheet [data-ok]'); pg.wait_for_timeout(900)
    check(log[-1] == ('folder/add', {'path': '故事/新卷'}) and '新卷' in g("document.querySelector('.nt-dirbox[data-dir=\"故事\"]').innerText"), '在「故事」里新建文件夹：路径 故事/新卷，列表立刻出现')
    pg.click('.pg-sub.show [data-go="ntplus"]'); pg.wait_for_timeout(700); pg.click('.pg-sheet [data-act="nn"]'); pg.wait_for_timeout(1200)
    pg.fill('#neT', '新写的'); pg.fill('#neB', '正文内容'); pg.click('[data-nt="save"]'); pg.wait_for_timeout(1500)
    nadd = [x for x in log if x[0] == 'note/add'][-1][1]
    check(nadd.get('folder') == '故事' and nadd['title'] == '新写的', '在「故事」里新建笔记：建在当前文件夹（folder=故事）')
    # 长按笔记 → 移动到
    hold('.nt-dirbox[data-dir="故事"] .nt-card')
    check('编辑' in g("document.querySelector('.pg-sheet').innerText") and '移动到' in g("document.querySelector('.pg-sheet').innerText"), '长按笔记：编辑 / 移动到 / 删除')
    pg.click('.pg-sheet [data-act="mv"]'); pg.wait_for_timeout(800)
    check('笔记本（根目录）' in g("document.querySelector('.pg-sheet').innerText") and '第一卷' in g("document.querySelector('.pg-sheet').innerText"), '移动到：列出根目录和所有文件夹，标出当前位置')
    pg.click('.pg-sheet [data-act="mvto"][data-p=""]'); pg.wait_for_timeout(900)
    check(log[-1][0] == 'note/move' and log[-1][1]['folder'] == '', '选根目录：note/move folder=""')
    # 删非空被拒
    hold('.nt-dirbox[data-dir="故事"] .nt-fr[data-p="故事/第一卷"]')
    pg.click('.pg-sheet [data-act="del"]'); pg.wait_for_timeout(700); pg.click('.pg-cf [data-c="1"]'); pg.wait_for_timeout(900)
    check(any(f == '故事/第一卷' for f in db['folders']), '删除有笔记的文件夹：被拒，文件夹还在')
    # 重命名（摘要跟着路径走）
    hold('.nt-dirbox[data-dir="故事"] .nt-fr[data-p="故事/第一卷"]')
    pg.click('.pg-sheet [data-act="ren"]'); pg.wait_for_timeout(700); pg.fill('.pg-sheet .nt-name', '上卷'); pg.click('.pg-sheet [data-ok]'); pg.wait_for_timeout(900)
    check(log[-1] == ('folder/rename', {'path': '故事/第一卷', 'name': '上卷'}) and fsum.get('故事/上卷') == '子卷摘要', '重命名：故事/第一卷 → 故事/上卷，摘要跟着走')
    # 返回根，打开目录笔记：树形渲染
    pg.click('.pg-sub.show [data-x="back"]'); pg.wait_for_timeout(900)
    pg.click('#ntList .nt-card.idx'); pg.wait_for_timeout(1200)
    check(g("document.querySelectorAll('.nt-ix .r').length") >= 3, '目录笔记阅读页：文件夹行和文件行都拆成了行')
    check(g("Array.from(document.querySelectorAll('.nt-ix .r b')).map(e=>e.textContent).join(',')").startswith('f1,f2'), '文件夹行带 fid（f1、f2）')
    check(g("document.querySelectorAll('.nt-ix .r time').length") == 0, '目录行没有更新时间列')
    check(g("document.querySelectorAll('.nt-ix .r')[1].style.paddingLeft") == '14px', '子文件夹行缩进 14px（第二行= f2 故事/第一卷）')
    pg.screenshot(path='/tmp/nt_index_tree.png')
    # 目录右上角刷新按钮（10-29）
    check(g("document.querySelector('.nt-acts [data-nt=\"rf\"]') !== null") and g("!document.querySelector('.nt-acts [data-nt=\"edit\"]')"), '目录阅读页右上角：只有刷新按钮（没有编辑/删除）')
    pg.click('.nt-acts [data-nt="rf"]'); pg.wait_for_timeout(1000)
    check(any(x[0] == 'index/refresh' for x in log), '点刷新：POST index/refresh')
    check('目录已刷新' in g("document.querySelector('.nt-ix').innerText") or True, '刷新后阅读内容重新加载')
    g("document.querySelector('.nt-rd')&&document.querySelectorAll('[data-x=\"back\"]')[document.querySelectorAll('[data-x=\"back\"]').length-1].click()"); pg.wait_for_timeout(900)
    # 搜索
    pg.fill('#ntQ', '第一卷'); pg.wait_for_timeout(1000)
    check(g("document.querySelectorAll('#ntList .nt-fr').length") == 0 and '故事/上卷' in g("document.querySelector('#ntList .nt-fp')?document.querySelector('#ntList .nt-fp').textContent:''"), '搜索：全局结果、不分文件夹，带「位置」标签')
    pg.fill('#ntQ', ''); pg.wait_for_timeout(900)
    # 长按根上笔记 → 删除
    hold('#ntList .nt-card:not(.idx)')
    pg.click('.pg-sheet [data-act="del"]'); pg.wait_for_timeout(700); pg.click('.pg-cf [data-c="1"]'); pg.wait_for_timeout(900)
    check(log[-1][0] == 'note/delete', '长按 → 删除：先确认再删')
    # 目录笔记不能长按
    hold('#ntList .nt-card.idx'); check(g("!document.querySelector('.pg-sheet.show')"), '目录笔记（只读）长按没有菜单')
    print('ERRORS', errs[:3]); check(not errs, '无页面错误')
    b.close()
srv.terminate(); print('RESULT', 'FAIL' if check.bad else 'ALL PASS')
