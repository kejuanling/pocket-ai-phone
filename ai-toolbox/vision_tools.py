# -*- coding: utf-8 -*-
"""[位置:ai-toolbox/vision_tools.py] [截图 / 看图 / 子智能体：从 yun-mcp-v2 复制进工具集] [11-04：想把 yun 的这几个给聊天里的 AI 用，这样可以关掉 yun 工具；实现照搬 yun-mcp-v2/mcp_server.py 的 screenshot / view_image / subagent，截图 worker 复制成同目录 shot_worker.py（用 mcp_env 的 python 跑，那里装了 playwright）。路径只放行项目目录和 /tmp 下的图片/页面，不给读别的] [11-13：screenshot 支持 local_storage 预置、随图返回页面信息；worker 同步；只回显键名不回显值] [注释时间 2026-11-13]"""

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
import base64, json, os, re, struct, subprocess, tempfile, urllib.parse
from pathlib import Path

HERE = Path(__file__).resolve().parent
SHOT_WORKER = HERE / "shot_worker.py"
SHOT_PY = os.path.join(PROJECT_ROOT, "mcp_env/bin/python3")
IMG_EXTS = {".png": "image/png", ".jpg": "image/jpeg", ".jpeg": "image/jpeg", ".gif": "image/gif", ".webp": "image/webp"}
IMG_RAW_LIMIT = 1_200_000
ROOTS = (PROJECT_ROOT, "/tmp/")
GATEWAY_BASE = "http://127.0.0.1:3000"


def _allowed(path):
    p = os.path.realpath(str(path))
    if not any(p.startswith(r) for r in ROOTS):
        raise ValueError("只能访问项目目录（${PROJECT_ROOT}）或 /tmp 下的文件")
    return Path(p)


def _raw_image(data, mime, note=""):
    # [位置:vision_tools.py·_raw_image] [图片结果可附一行文字] [11-13：截图只回图，AI 分不清日夜两版、不知道截自哪页；text+image 混合 content 由 mcp-service.js _flattenToolResult 消费] [注释时间 2026-11-13]
    content = []
    if note:
        content.append({"type": "text", "text": note})
    content.append({"type": "image", "data": base64.b64encode(data).decode(), "mimeType": mime})
    return {"__mcp_raw_result__": {"content": content}}


def _run_shot_meta(args, timeout):
    # [位置:vision_tools.py·_run_shot_meta] [解析 worker stdout 元数据] [11-13：worker 成功时 stdout 为「OK {json}」，仍以 OK 判定；解析失败静默降级为无文字，兼容旧 worker] [注释时间 2026-11-13]
    out = tempfile.NamedTemporaryFile(prefix="tool_shot_", suffix=".jpg", delete=False)
    out.close()
    args = dict(args, out=out.name)
    try:
        r = subprocess.run([SHOT_PY, str(SHOT_WORKER), json.dumps(args, ensure_ascii=False)],
                           stdout=subprocess.PIPE, stderr=subprocess.PIPE, universal_newlines=True, timeout=timeout)
        if r.returncode != 0 or "OK" not in r.stdout:
            tail = (r.stderr or r.stdout or "").strip().splitlines()[-6:]
            raise RuntimeError("截图失败：" + " | ".join(tail))
        with open(out.name, "rb") as f:
            data = f.read()
        meta = {}
        for line in r.stdout.splitlines():
            if line.startswith("OK "):
                try:
                    meta = json.loads(line[3:].strip())
                except Exception:
                    meta = {}
                break
        return data, meta
    finally:
        try: os.unlink(out.name)
        except OSError: pass


def _run_shot(args, timeout):
    # [位置:vision_tools.py·_run_shot] [view_image 沿用旧出口] [11-13：看图不需要元数据，包装一层避免动它] [注释时间 2026-11-13]
    data, _ = _run_shot_meta(args, timeout)
    return data


def tool_screenshot(args):
    u = str(args.get("url") or "").strip()
    if not u:
        return {"error": "url 必填"}
    if not re.match(r"^(https?|file)://", u):
        u = _allowed(u).as_uri()
    elif u.startswith("file://"):
        _allowed(urllib.parse.unquote(u[7:]))
    width = max(200, min(int(args.get("width") or 390), 1600))
    height = max(200, min(int(args.get("height") or 844), 3000))
    scale = max(1.0, min(float(args.get("scale") or 1.0), 2.0))
    click = args.get("click") or []
    if isinstance(click, str): click = [click]
    ls = args.get("local_storage")
    # [位置:vision_tools.py·tool_screenshot local_storage] [预置页面本地状态并回传页面信息] [11-13：通用注入代替写死的主题开关；值可能含敏感信息，只有键名进上下文；空/超长/类型不对直接拒绝] [注释时间 2026-11-13]
    if ls is not None and not isinstance(ls, dict):
        return {"error": "local_storage 必须是键值对象"}
    ls = {str(k): str(v) for k, v in (ls or {}).items()}
    if len(ls) > 30 or any(len(k) > 200 or len(v) > 8000 for k, v in ls.items()):
        return {"error": "local_storage 最多 30 个键，键长 ≤200、值长 ≤8000"}
    data, meta = _run_shot_meta({"mode": "page", "url": u, "width": width, "height": height, "scale": scale, "dark": bool(args.get("dark")),
                                "wait_ms": max(0, min(int(args.get("wait_ms") or 800), 15000)), "click": click,
                                "selector": str(args.get("selector") or ""), "full_page": bool(args.get("full_page")),
                                "auth": args.get("auth") is not False, "unlock": args.get("unlock") is not False,
                                "local_storage": ls}, timeout=60)
    return _raw_image(data, "image/jpeg", meta.get("note", ""))


def _img_size(p):
    try:
        with open(p, "rb") as f:
            head = f.read(64)
            if head[:8] == b"\x89PNG\r\n\x1a\n":
                return struct.unpack(">II", head[16:24])
            if head[:6] in (b"GIF87a", b"GIF89a"):
                return struct.unpack("<HH", head[6:10])
            if head[:4] == b"RIFF" and head[8:12] == b"WEBP":
                kind = head[12:16]
                if kind == b"VP8X":
                    return (int.from_bytes(head[24:27], "little") + 1, int.from_bytes(head[27:30], "little") + 1)
                if kind == b"VP8L":
                    b = int.from_bytes(head[21:25], "little")
                    return ((b & 0x3FFF) + 1, ((b >> 14) & 0x3FFF) + 1)
                if kind == b"VP8 ":
                    w, h = struct.unpack("<HH", head[26:30])
                    return (w & 0x3FFF, h & 0x3FFF)
                return None
            if head[:2] == b"\xff\xd8":
                f.seek(2)
                while True:
                    b = f.read(1)
                    if not b: return None
                    if b != b"\xff": continue
                    m = f.read(1)
                    while m == b"\xff": m = f.read(1)
                    if not m or m in (b"\x01",) or b"\xd0" <= m <= b"\xd9": continue
                    seg = f.read(2)
                    if len(seg) < 2: return None
                    n = struct.unpack(">H", seg)[0]
                    if m[0] in (0xC0, 0xC1, 0xC2, 0xC3, 0xC5, 0xC6, 0xC7, 0xC9, 0xCA, 0xCB, 0xCD, 0xCE, 0xCF):
                        d = f.read(5)
                        h, w = struct.unpack(">HH", d[1:5])
                        return (w, h)
                    f.seek(n - 2, 1)
    except Exception:
        return None
    return None


def tool_view_image(args):
    path = str(args.get("path") or "").strip()
    if not path:
        return {"error": "path 必填"}
    p = _allowed(path)
    if not p.is_file():
        return {"error": "不是文件: %s" % p}
    ext = p.suffix.lower()
    if ext not in IMG_EXTS:
        return {"error": "只支持 png / jpg / jpeg / gif / webp"}
    mw = max(200, min(int(args.get("max_width") or 1280), 2400))
    mh = max(200, min(int(args.get("max_height") or 2400), 4000))
    size = _img_size(p)
    over = bool(size) and (size[0] > mw or size[1] > mh)
    if p.stat().st_size <= IMG_RAW_LIMIT and not over:
        return _raw_image(p.read_bytes(), IMG_EXTS[ext])
    html = tempfile.NamedTemporaryFile(prefix="tool_img_", suffix=".html", delete=False, mode="w", encoding="utf-8")
    html.write('<body style="margin:0"><img src="%s" style="display:block;width:auto;height:auto;max-width:%dpx;max-height:%dpx"></body>' % (p.as_uri(), mw, mh))
    html.close()
    try:
        data = _run_shot({"mode": "image", "url": "file://" + html.name, "width": mw, "height": min(mh, 1200), "wait_ms": 300,
                          "selector": "img", "quality": 80}, timeout=60)
    finally:
        try: os.unlink(html.name)
        except OSError: pass
    return _raw_image(data, "image/jpeg")


def _internal_key():
    try:
        with open(os.path.join(PROJECT_ROOT, ".env"), encoding="utf-8") as f:
            for line in f:
                line = line.strip()
                if line.startswith("INTERNAL_API_KEY="):
                    return line.split("=", 1)[1].strip().strip('"').strip("'")
    except Exception:
        pass
    return ""


def _gateway(method, path, params=None, body=None, timeout=15):
    import urllib.request
    key = _internal_key()
    if not key:
        return {"ok": False, "error": "网关内部密钥缺失"}
    url = GATEWAY_BASE + path + ("?" + urllib.parse.urlencode(params) if params else "")
    data = json.dumps(body or {}).encode() if method == "POST" else None
    req = urllib.request.Request(url, data=data, method=method, headers={"x-internal-key": key, "Content-Type": "application/json"})
    try:
        with urllib.request.urlopen(req, timeout=timeout) as r:
            return json.loads(r.read().decode())
    except Exception as e:
        return {"ok": False, "error": "调网关失败：%s" % e}


def tool_subagent(args):
    act = str(args.get("action") or "").strip()
    sid = str(args.get("subagent_id") or "").strip()
    if act == "run":
        t = str(args.get("task") or "").strip()
        if not t:
            return {"ok": False, "error": "缺少 task（任务提示词）"}
        body = {"task": t, "parent_session": ""}
        if sid: body["session_id"] = sid
        if str(args.get("preset") or "").strip(): body["preset"] = str(args["preset"]).strip()
        r = _gateway("POST", "/internal/subagent/start", body=body, timeout=60)
        # [位置:vision_tools.py·subagent run 返回] [批3精简（11-05）：model/status/reused/hint 对派活的 AI 无增量信息，只留 ok+subagent_id] [注释时间 2026-11-05]
        if isinstance(r, dict) and r.get("ok"):
            return {"ok": True, "subagent_id": r.get("subagent_id")}
        return r
    if act == "report":
        return _gateway("GET", "/internal/subagent/report", params={"session_id": sid, "tag": str(args.get("tag") or "").strip()})
    if act == "log":
        params = {"session_id": sid, "start_line": int(args.get("start_line") or 0)}
        if int(args.get("end_line") or 0) > 0: params["end_line"] = int(args["end_line"])
        r = _gateway("GET", "/internal/subagent/log", params=params)
        # [位置:vision_tools.py·subagent log 返回] [批3精简（11-05）：subagent_id/range 是入参回显砍；status/total/items/has_more/hint 保留] [注释时间 2026-11-05]
        if isinstance(r, dict) and r.get("ok"):
            return {k: v for k, v in r.items() if k not in ("subagent_id", "range")}
        return r
    return {"ok": False, "error": "action 只支持 run / report / log"}


SCREENSHOT_DESC = "给网页截图并直接返回图片，图前附一行页面信息（实际网址、主题、视口；失败时附实际停留的网址）。url：http(s) 地址，或服务器上的文件路径（项目目录 / tmp 下）。默认手机尺寸 390x844；width/height 即视口也是截图尺寸，想省上下文就小一点或只截 selector。dark=true 只改浏览器的系统深色偏好，本站日夜不听它：截小手机白天/夜晚用 local_storage={\"ph_appear\":\"day\"} 或 {\"ph_appear\":\"night\"}，也可用它预置其它本地状态（返回只列键名，不列值）。click=依次点击的 CSS 选择器列表（先点开菜单/弹窗再截）；selector 只截某个元素；full_page 截整页长图；scale 1~2（2=高清，图更大）；wait_ms 等待毫秒。本站页面自动带登录态并自动解开锁屏，直接截到登录后的样子；auth=false 截未登录的样子，unlock=false 截锁屏本身。"
VIEW_IMAGE_DESC = "看服务器上的本地图片（png/jpg/gif/webp；项目目录 / tmp 下）并直接返回图片。max_width / max_height 是返回图的最大宽高（默认 1280 / 2400），超过就等比缩小；想看清细节调大，想省上下文调小。"
SUBAGENT_DESC = "派子智能体干杂活（用「新建会话预设」开的独立会话，人设/模型/工具在预设里配，默认预设「子会话」；不占你的上下文）。run：task 必填（写清楚要干什么，并交代不可重启网关）；subagent_id 可选（传=续用那个子会话，不传=新建）；preset 可选（新建时用哪个预设，缺省「子会话」）；立刻返回任务 id，不等待。子智能体较慢，派完用 wake 定个几分钟后的唤醒，到点再 report。report：subagent_id 必填；tag 可选（缺省=最新一份 report_NN，也可填 report_02）；没找到=还未完成。log：subagent_id + start_line 必填（从 1 起），end_line 可选（缺省=start_line+39）；内容是 AI 正文全文与每次工具调用（名+完整参数，出错附错误信息），不含工具结果与思考；长内容按约 1800 字切块。你和子智能体都禁止重启网关，需要重启在报告里说明，由用户决定。"

SCHEMAS = {
    "screenshot": {"type": "object", "properties": {
        "url": {"type": "string", "description": "http(s):// 地址，或服务器上的文件路径"},
        "width": {"type": "integer", "description": "视口宽，默认 390"}, "height": {"type": "integer", "description": "视口高，默认 844"},
        "full_page": {"type": "boolean", "description": "截整页长图"}, "dark": {"type": "boolean", "description": "只改浏览器系统深色偏好；本站日夜用 local_storage 的 ph_appear"},
        "wait_ms": {"type": "integer", "description": "加载后等待毫秒，默认 800"},
        "click": {"type": "array", "items": {"type": "string"}, "description": "依次点击的 CSS 选择器"},
        "selector": {"type": "string", "description": "只截这个元素"}, "scale": {"type": "number", "description": "1~2，默认 1"},
        "auth": {"type": "boolean", "description": "本站页面自动带登录态，默认 true；false 截未登录的样子"},
        "unlock": {"type": "boolean", "description": "自动解开小手机锁屏，默认 true；false 截锁屏本身"},
        "local_storage": {"type": "object", "description": "截图前注入页面 localStorage 的键值（如 {\"ph_appear\":\"night\"} 切夜间）；在页面脚本执行前写入，只回显键名不回显值"}},
        "required": ["url"]},
    "view_image": {"type": "object", "properties": {
        "path": {"type": "string", "description": "图片的服务器路径"},
        "max_width": {"type": "integer", "description": "最大宽，默认 1280"}, "max_height": {"type": "integer", "description": "最大高，默认 2400"}},
        "required": ["path"]},
    "subagent": {"type": "object", "properties": {
        "action": {"type": "string", "enum": ["run", "report", "log"], "description": "run=派活；report=取报告；log=看过程记录"},
        "task": {"type": "string", "description": "run：任务提示词"},
        "subagent_id": {"type": "string", "description": "run：续用的子会话；report / log：目标子会话"},
        "preset": {"type": "string", "description": "run：新建时用的预设名，缺省「子会话」"},
        "tag": {"type": "string", "description": "report：报告标签（如 report_02），缺省=最新"},
        "start_line": {"type": "integer", "description": "log：起始记录序号（从 1 起）"},
        "end_line": {"type": "integer", "description": "log：结束记录序号，缺省 start_line+39"}},
        "required": ["action"]},
}


def register(TOOLS):
    TOOLS["screenshot"] = {"description": SCREENSHOT_DESC, "inputSchema": SCHEMAS["screenshot"], "handler": tool_screenshot}
    TOOLS["view_image"] = {"description": VIEW_IMAGE_DESC, "inputSchema": SCHEMAS["view_image"], "handler": tool_view_image}
    TOOLS["subagent"] = {"description": SUBAGENT_DESC, "inputSchema": SCHEMAS["subagent"], "handler": tool_subagent}
