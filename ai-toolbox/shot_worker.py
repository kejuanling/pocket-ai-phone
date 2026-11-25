"""yun-mcp-v2 截图 worker（子进程，崩了不拖垮 MCP 服务）。
[位置:yun-mcp-v2/shot_worker.py] [无头浏览器截图 / 大图缩放] [10-27：让 AI 能直接看页面长什么样（日夜两版、点开菜单后的样子），不用再靠断言猜] [注释时间 2026-10-27]
用法：python shot_worker.py '<json 参数>'，成功往 stdout 打印一行 OK（后面跟页面元数据 JSON），输出图片写在 args["out"]。
mode=page：打开 url 截图（支持快捷 page/theme/session_id、dark、多步动作 click/text=/wait:/scroll:/open:、只截某个元素）；mode=image：把本地大图缩到 max_width 再出 jpeg。
[11-12 优化] auth（默认开）向网关取 1 小时短期登录态；unlock（默认开）自动上滑解锁。
[11-13 优化] local_storage 预置；stdout 回传页面元数据与随图文字；失败带落地页。
[涵 11-17 优化] 自签证书 https 放开 ignore_https_errors=True。
[涵 11-21 优化] 面向 AI 全面升级：
  1. 快捷参数 theme（day/night/min_day/min_night）、page（chat/drawer/avatar/more/state/state_cfg/note/note_set/set/tools/theme/mem/wake/cal/todo/trace/perm/star/lock）、session_id；
  2. auth=true 自动顺手注入 localStorage.han_logged_in="1"；
  3. click 支持 .first 防多元素报错、支持 text=中文点击、wait:ms、scroll:px/bottom、wait_for:sel、open:appId；
  4. 点击后智能等待加载态消失；
  5. 失败时截取现场图 + 列出当前页面可见按钮/标题，输出 FAIL_SHOT {json} 供工具层一并返回给 AI，彻底告别盲猜。
"""

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
import json
import sys
import urllib.request
from pathlib import Path
from urllib.parse import urlparse

from playwright.sync_api import sync_playwright


GATEWAY_BASE = "http://127.0.0.1:3000"
PHONE_DEFAULT_URL = "https://127.0.0.1:9002/phone-new.html"
ENV_FILE = Path(os.path.join(PROJECT_ROOT, ".env"))

DIRECT_APPS = {"set", "note", "tools", "theme", "mem", "wake", "cal", "todo", "trace", "perm", "star", "pulse", "diary", "me", "chats"}


class ShotError(Exception):
    pass


def _internal_key() -> str:
    import os
    k = os.environ.get("INTERNAL_API_KEY", "").strip()
    if k:
        return k
    try:
        for line in ENV_FILE.read_text(encoding="utf-8").splitlines():
            if line.strip().startswith("INTERNAL_API_KEY="):
                return line.split("=", 1)[1].strip().strip('"').strip("'")
    except OSError:
        pass
    return ""


def _login_cookies(url: str):
    """本站 http(s) 页面才取登录态；外部网址 / file:// 返回 None（不发 cookie 给别人）。"""
    u = urlparse(url)
    if u.scheme not in ("http", "https") or not u.hostname:
        return None
    key = _internal_key()
    if not key:
        raise ShotError("取登录态失败：INTERNAL_API_KEY 没找到（想截未登录的样子可传 auth=false）")
    try:
        req = urllib.request.Request(GATEWAY_BASE + "/internal/shot-session", headers={"x-internal-key": key})
        opener = urllib.request.build_opener(urllib.request.ProxyHandler({}))
        j = json.loads(opener.open(req, timeout=8).read().decode("utf-8"))
    except Exception as e:
        raise ShotError("取登录态失败：网关 /internal/shot-session 调不通（%s）；想截未登录的样子可传 auth=false" % e)
    if u.hostname not in (j.get("hosts") or []):
        return None
    secure = u.scheme == "https"
    origin = "%s://%s" % (u.scheme, u.netloc)
    return [
        {"name": "admin_session", "value": j["session"], "url": origin, "httpOnly": True, "secure": secure, "sameSite": "Lax"},
        {"name": "admin_csrf", "value": j["csrf"], "url": origin, "secure": secure, "sameSite": "Lax"},
    ]


def _lock_visible(pg) -> bool:
    return bool(pg.evaluate(
        "()=>{const e=document.getElementById('lock'); if(!e) return false; const c=getComputedStyle(e);"
        "return c.display!=='none'&&c.visibility!=='hidden'&&parseFloat(c.opacity)>0.05;}"))


def _swipe_unlock(pg, w: int, h: int) -> None:
    """小手机锁屏靠 pointer 事件上滑解锁（phone-new.html·drag），用鼠标模拟，不依赖页面里 unlock 是不是全局函数。"""
    x = w // 2
    pg.mouse.move(x, int(h * 0.85))
    pg.mouse.down()
    for i in range(1, 9):
        pg.mouse.move(x, int(h * (0.85 - 0.08 * i)))
        pg.wait_for_timeout(16)
    pg.mouse.up()
    pg.wait_for_timeout(850)


LAST_URL = {"target": "", "landed": ""}


def _target_origin(url: str) -> str:
    u = urlparse(url)
    if u.scheme in ("http", "https"):
        return "%s://%s" % (u.scheme, u.netloc)
    if u.scheme == "file":
        return "null"
    return ""


def _build_local_storage(a: dict, has_cookies: bool) -> dict:
    """合并 theme / session_id / auth 默认标记与显式 local_storage（显式传参优先级最高）。"""
    merged = {}
    if has_cookies:
        merged["han_logged_in"] = "1"
    theme = str(a.get("theme") or "").strip().lower()
    page_name = str(a.get("page") or "").strip().lower()
    # 未指定 theme 时，截 drawer/chat/state/state_cfg/avatar/more 默认走 min_night 最常用
    if not theme and page_name in ("drawer", "chat", "avatar", "more", "state", "state_cfg"):
        theme = "min_night"
    if theme in ("day", "bubble_day"):
        merged["ph_appear"] = "day"
        merged["ph.chattheme.v1"] = json.dumps({"v": 1, "style": "bubble"})
    elif theme in ("night", "bubble_night"):
        merged["ph_appear"] = "night"
        merged["ph.chattheme.v1"] = json.dumps({"v": 1, "style": "bubble"})
    elif theme in ("min_day",):
        merged["ph_appear"] = "day"
        merged["ph.chattheme.v1"] = json.dumps({"v": 1, "style": "min"})
    elif theme in ("min_night", "min"):
        merged["ph_appear"] = "night"
        merged["ph.chattheme.v1"] = json.dumps({"v": 1, "style": "min"})
    sid = str(a.get("session_id") or "").strip()
    if sid:
        merged["ph.min.last_sid"] = sid
    ls = a.get("local_storage")
    if isinstance(ls, dict):
        for k, v in ls.items():
            merged[str(k)] = str(v)
    return merged


def _init_script(entries, url: str) -> str:
    if not isinstance(entries, dict) or not entries:
        return ""
    items = {str(k): str(v) for k, v in entries.items()}
    want = _target_origin(url)
    return ("(()=>{try{const want=%s,items=%s;"
            "if(want&&location.origin!==want&&!(want==='null'&&location.protocol==='file:'))return;"
            "for(const k of Object.keys(items)){localStorage.setItem(k,items[k]);}"
            "}catch(e){}})();") % (json.dumps(want, ensure_ascii=False), json.dumps(items, ensure_ascii=False))


def _wait_settled(pg, max_ms: int = 2400) -> None:
    """智能等待页面加载态（loadbox / pg-ld.on / 加载动画）散去，避免截到转圈。"""
    pg.wait_for_timeout(380)
    try:
        pg.wait_for_function(
            "()=>{const busy=document.querySelectorAll('.pg-ld.on, .loadbox, .ph-ld.on');"
            "for(const el of busy){const c=getComputedStyle(el);if(c.display!=='none'&&c.visibility!=='hidden'&&parseFloat(c.opacity)>0.05) return false;}"
            "return true;}",
            timeout=max_ms
        )
        pg.wait_for_timeout(180)
    except Exception:
        pass


def _open_app_js(pg, app_id: str) -> None:
    ok = pg.evaluate(
        "(id)=>{if(window.PH&&typeof window.PH.open==='function'){window.PH.open(id,null,{instant:true});return true;}return false;}",
        app_id
    )
    if not ok:
        raise ShotError("页面未暴露 PH.open，无法直接打开页面：%s" % app_id)
    _wait_settled(pg, 2800)


def _scroll_action(pg, spec: str) -> None:
    pg.evaluate(
        "(spec)=>{const cands=Array.from(document.querySelectorAll('.pg-sub .pg-sc, .win:last-of-type .sc, .win:last-of-type .pg-sc, .cs-sc, .mn-scroll, .tk-ms'));"
        "let target=null;"
        "for(let i=cands.length-1;i>=0;i--){const el=cands[i];if(el.offsetParent!==null&&el.scrollHeight>el.clientHeight+10){target=el;break;}}"
        "const val=spec==='bottom'?99999:(spec==='top'?0:parseInt(spec,10)||360);"
        "if(target){if(spec==='bottom'||spec==='top') target.scrollTop=val; else target.scrollTop+=val;}"
        "else{if(spec==='bottom') window.scrollTo(0,document.body.scrollHeight); else if(spec==='top') window.scrollTo(0,0); else window.scrollBy(0,val);}}",
        spec
    )
    pg.wait_for_timeout(350)


def _run_step(pg, raw: str) -> None:
    s = str(raw or "").strip()
    if not s:
        return
    if s.startswith("wait:"):
        ms = max(50, min(int(s[5:].strip() or "500"), 15000))
        pg.wait_for_timeout(ms)
        return
    if s.startswith("scroll:"):
        _scroll_action(pg, s[7:].strip().lower())
        return
    if s.startswith("open:"):
        _open_app_js(pg, s[5:].strip())
        return
    if s.startswith("wait_for:"):
        sel = s[9:].strip()
        pg.locator(sel).first.wait_for(state="visible", timeout=8000)
        return
    if s.startswith("text="):
        txt = s[5:].strip()
        loc = pg.get_by_text(txt, exact=False).first
        loc.wait_for(state="visible", timeout=6000)
        loc.scroll_into_view_if_needed(timeout=3000)
        loc.click(timeout=5000)
        _wait_settled(pg, 2200)
        return
    # 普通 CSS 选择器：统一取 .first，避免多元素 strict mode 报错
    loc = pg.locator(s).first
    loc.wait_for(state="visible", timeout=6000)
    try:
        loc.scroll_into_view_if_needed(timeout=2000)
    except Exception:
        pass
    loc.click(timeout=5000)
    _wait_settled(pg, 2200)


def _apply_page_shortcut(pg, page_name: str, session_id: str) -> None:
    """内置小手机快捷页面跳转，AI 不必背选择器。"""
    p = str(page_name or "").strip().lower()
    if not p or p == "lock":
        return
    if p in DIRECT_APPS:
        _open_app_js(pg, p)
        return
    if p == "note_set":
        _open_app_js(pg, "note")
        _run_step(pg, "#ntSet")
        return
    # 聊天相关页面：若非极简模式且还没开聊天层，先切进 chats 打开会话
    if p in ("chat", "drawer", "avatar", "more", "state", "state_cfg"):
        has_chat = bool(pg.evaluate("()=>!!document.querySelector('.win.tk-layer')"))
        if not has_chat:
            _open_app_js(pg, "chats")
            if session_id:
                pg.evaluate("(sid)=>{if(window.PH&&window.PH.chats&&window.PH.chats.switchTo) window.PH.chats.switchTo(sid);}", session_id)
                _wait_settled(pg, 2600)
            else:
                _run_step(pg, ".cs-it:not(.cs-grp)")
        elif session_id:
            pg.evaluate("(sid)=>{if(window.PH&&window.PH.chats&&window.PH.chats.switchTo) window.PH.chats.switchTo(sid);}", session_id)
            _wait_settled(pg, 2200)
        if p == "chat":
            return
        if p == "drawer":
            pg.evaluate("()=>{if(window.PH&&window.PH.minLayout&&window.PH.minLayout.openDrawer) window.PH.minLayout.openDrawer();}")
            _wait_settled(pg, 1200)
            return
        if p == "avatar":
            _run_step(pg, "#tkAv")
            return
        if p == "more":
            _run_step(pg, "#tkMore")
            return
        if p == "state":
            _run_step(pg, "#tkMore")
            _run_step(pg, '[data-go="state"]')
            return
        if p == "state_cfg":
            _run_step(pg, "#tkMore")
            _run_step(pg, '[data-go="state"]')
            _run_step(pg, "#tkStGear")
            return


def _visible_hints(pg) -> str:
    """失败时抓取当前页面可见标题和前 14 个可点元素，帮助 AI 一眼定位下一步。"""
    try:
        info = pg.evaluate("""()=>{
          const vis = (el)=>{
            if(!el) return false;
            const r = el.getBoundingClientRect();
            if(r.width < 4 || r.height < 4) return false;
            const c = getComputedStyle(el);
            return c.display !== 'none' && c.visibility !== 'hidden' && parseFloat(c.opacity) > 0.05;
          };
          const out = [];
          const els = document.querySelectorAll('button, [role="button"], [data-go], [data-act], .pg-r, h1, .ttl');
          for(const el of els){
            if(!vis(el)) continue;
            const t = (el.innerText || el.getAttribute('aria-label') || '').replace(/\\s+/g,' ').trim().slice(0,24);
            const id = el.id ? ('#'+el.id) : '';
            const go = el.getAttribute('data-go') ? ('[data-go="'+el.getAttribute('data-go')+'"]') : '';
            const label = [t, id || go].filter(Boolean).join(' ');
            if(label && out.indexOf(label) < 0) out.push(label);
            if(out.length >= 14) break;
          }
          return out;
        }""")
        if info:
            return "当前可见元素：" + " / ".join(info)
    except Exception:
        pass
    return ""


def _page_meta(pg, a: dict, ls_keys: list) -> dict:
    meta = {"url": pg.url, "title": "", "data_theme": "", "ph_appear": "",
            "width": a.get("width"), "height": a.get("height"),
            "dark": bool(a.get("dark")), "local_storage_keys": sorted(ls_keys)}
    try:
        meta["title"] = (pg.title() or "")[:60]
    except Exception:
        pass
    try:
        st = pg.evaluate("()=>{let e=document.querySelector('#device')||document.documentElement;"
                         "let t=(e&&e.getAttribute('data-theme'))||'';let a='';"
                         "try{a=localStorage.getItem('ph_appear')||'';}catch(e){}"
                         "return {theme:t,appear:a};}")
        meta["data_theme"] = str(st.get("theme") or "")
        meta["ph_appear"] = str(st.get("appear") or "")
    except Exception:
        pass
    theme = ("night" if meta["data_theme"] == "dark" or meta["ph_appear"] == "night"
             else "day" if meta["ph_appear"] == "day" else (meta["data_theme"] or "默认"))
    note = "截自 %s" % meta["url"]
    if meta["title"]:
        note += "（%s）" % meta["title"]
    if a.get("page"):
        note += " | page=%s" % a["page"]
    note += " | 主题 %s | 视口 %sx%s" % (theme, meta["width"], meta["height"])
    if ls_keys:
        note += " | local_storage: %s" % ",".join(sorted(ls_keys))
    meta["note"] = note
    return meta


def main() -> int:
    try:
        return run(json.loads(sys.argv[1]))
    except Exception as e:
        if LAST_URL.get("landed"):
            tail = "｜实际停在 %s" % LAST_URL["landed"]
        elif LAST_URL.get("target"):
            tail = "｜请求地址 %s" % LAST_URL["target"]
        else:
            tail = ""
        print("截图失败：%s%s" % (e, tail), file=sys.stderr)
        return 2


def run(a: dict) -> int:
    meta = {}
    url = str(a.get("url") or "").strip()
    if not url or url.lower() == "phone":
        url = PHONE_DEFAULT_URL
    a["url"] = url
    LAST_URL["target"] = url
    LAST_URL["landed"] = ""
    page_name = str(a.get("page") or "").strip().lower()
    want_unlock = bool(a.get("unlock", True)) and page_name != "lock"

    with sync_playwright() as p:
        b = p.chromium.launch()
        try:
            ctx = b.new_context(
                viewport={"width": a["width"], "height": a["height"]},
                device_scale_factor=a.get("scale", 1),
                color_scheme="dark" if a.get("dark") else "light",
                ignore_https_errors=True,
            )
            cookies = _login_cookies(url) if a.get("auth", True) and a.get("mode") != "image" else None
            if cookies:
                ctx.add_cookies(cookies)
            ls_merged = _build_local_storage(a, bool(cookies))
            init = _init_script(ls_merged, url)
            if init:
                ctx.add_init_script(script=init)
            pg = ctx.new_page()
            pg.goto(url, wait_until="load", timeout=a.get("timeout", 20) * 1000)
            LAST_URL["landed"] = pg.url
            try:
                pg.wait_for_load_state("networkidle", timeout=5000)
            except Exception:
                pass
            pg.wait_for_timeout(a.get("wait_ms", 800))
            if want_unlock and not pg.locator(".phlogin").count() and _lock_visible(pg):
                _swipe_unlock(pg, a["width"], a["height"])
                if _lock_visible(pg):
                    raise ShotError("页面停在锁屏，模拟上滑没解开（想截锁屏本身可传 unlock=false）")
            if cookies and (pg.locator(".phlogin").count() or "/login" in urlparse(pg.url).path):
                raise ShotError("登录态没生效，截到的是登录页（想截未登录的样子可传 auth=false）")

            try:
                if page_name:
                    _apply_page_shortcut(pg, page_name, str(a.get("session_id") or "").strip())
                for sel in a.get("click") or []:
                    _run_step(pg, sel)
            except Exception as step_err:
                LAST_URL["landed"] = pg.url
                hints = _visible_hints(pg)
                err_msg = "操作步骤失败：%s｜停在 %s" % (step_err, pg.url)
                if hints:
                    err_msg += "｜" + hints
                try:
                    pg.screenshot(path=a["out"], type="jpeg", quality=65)
                    print("FAIL_SHOT " + json.dumps({"error": err_msg, "url": pg.url}, ensure_ascii=False))
                    return 0
                except Exception:
                    raise ShotError(err_msg)

            LAST_URL["landed"] = pg.url
            kw = {"path": a["out"], "type": "jpeg", "quality": a.get("quality", 72)}
            if a.get("selector"):
                pg.locator(a["selector"]).first.screenshot(**kw)
            else:
                pg.screenshot(full_page=bool(a.get("full_page")), **kw)
            meta = _page_meta(pg, a, list(ls_merged.keys()))
        finally:
            b.close()
    print("OK " + json.dumps(meta, ensure_ascii=False))
    return 0


if __name__ == "__main__":
    sys.exit(main())
