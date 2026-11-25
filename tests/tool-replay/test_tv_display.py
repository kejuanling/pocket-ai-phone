
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
PORT = 8896
srv = subprocess.Popen(['python3', '-m', 'http.server', str(PORT), '--bind', '127.0.0.1'], cwd=os.path.join(PROJECT_ROOT, 'workspace'), stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
time.sleep(1)
def check(c, m):
    print(('PASS ' if c else 'FAIL ') + m)
    if not c: check.bad = True
check.bad = False
with sync_playwright() as p:
    b = p.chromium.launch(); pg = b.new_context(viewport={'width': 390, 'height': 800}).new_page()
    errs = []; pg.on('pageerror', lambda e: errs.append(str(e)))
    pg.route(re.compile(r'.*/(v1|heartbeat)/.*'), lambda r: r.fulfill(status=200, content_type='application/json', body='{}'))
    pg.goto('http://127.0.0.1:%d/phone-new.html' % PORT); pg.wait_for_timeout(1200)
    pg.evaluate("""()=>{var P=window.PH, app=P.app('chats'); var w=document.createElement('div'); w.className='win'; w.dataset.win='chats'; P.D.appendChild(w); w.innerHTML=app.html(); app.setup(w); P.openChat&&0; }""")
    # P.tv 在聊天页 setup 时才挂上：直接开一个聊天页
    ok = pg.evaluate("typeof (window.PH.tv)")
    print('PH.tv type before chat:', ok)
    pg.evaluate("""()=>{ var P=window.PH; var w=document.createElement('div'); w.className='win'; w.dataset.win='talk'; P.D.appendChild(w); var a=P.app('talk'); w.innerHTML=a.html({sid:'s_tv'}); a.setup(w,{sid:'s_tv'}); }""")
    pg.wait_for_timeout(800)
    r = pg.evaluate("""()=>{ var T=window.PH.tv; if(!T) return null; return {
      a1:T.args({name:'album',args:{action:'add',img:'i1',note:'',session_id:'s_x'}}),
      a2:T.args({name:'subagent',args:'{"action":"report","session_id":"s_sub_k","tag":""}'}),
      a3:T.args({name:'wake',args:{session_id:'s_x'}}),
      a4:T.args({name:'run_command',args:'{"command":"ls"'}),
      r1:T.res({name:'album',result:'{"ok":true,"existed":false,"item":{"id":"al_1","desc":"","note":"n"}}'}),
      r2:T.res({name:'x',result:'{"ok":true}'}),
      r3:T.res({name:'x',result:'{"ok":false,"error":"boom"}'}),
      r4:T.res({name:'x',result:'plain text'}),
      r5:T.res({name:'x',error:'failed hard',result:''}),
      r6:T.res({name:'x',result:'[1,2]'}),
      r7:T.res({name:'x',result:'{"success":true,"id":58,"title":"T"}'}) } }""")
    print(json.dumps(r, ensure_ascii=False, indent=1))
    check(r is not None, 'PH.tv exposed')
    check('session_id' not in r['a1'] and 'img' in r['a1'] and 'note' not in r['a1'], 'album: hide session_id + empty note')
    check('s_sub_k' in r['a2'] and 'tag' not in r['a2'], 'subagent keeps session_id, empty tag dropped')
    check(r['a3'] == '', 'only injected id -> no 入参 box')
    check(r['a4'] == '{"command":"ls"', 'partial streaming args shown as is')
    check('"ok"' not in r['r1'] and 'existed' in r['r1'] and 'desc' not in r['r1'] and 'al_1' in r['r1'], 'result: ok:true dropped, nested kept (desc empty inside nested kept ok)')
    check(r['r2'] == '完成', '{ok:true} -> 完成')
    check('"ok": false' in r['r3'] and 'boom' in r['r3'], 'ok:false kept')
    check(r['r4'] == 'plain text' and r['r5'] == 'failed hard' and r['r6'] == '[1,2]', 'plain/error/array untouched')
    check('success' not in r['r7'] and '58' in r['r7'], 'success:true dropped')
    print('ERRORS', errs[:3]); b.close()
srv.terminate(); print('RESULT', 'FAIL' if check.bad else 'ALL PASS')
