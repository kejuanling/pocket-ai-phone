#!/usr/bin/env python3
"""
🌐 MCP 工具集 · 小世界全能工具包
暴露服务器上所有可用工具（除去Claude已有工具）
端口: 8771 · 鉴权: Bearer Token
协议: JSON-RPC 2.0
"""
from http.server import HTTPServer, BaseHTTPRequestHandler
from socketserver import ThreadingMixIn

class ThreadingHTTPServer(ThreadingMixIn, HTTPServer):
    daemon_threads = True
import json, urllib.request, urllib.parse, urllib.error, os, re, time, subprocess, threading
import datetime

def _project_root():
    env = os.environ.get("PROJECT_ROOT", "").strip()
    if env:
        from pathlib import Path as _P
        return _P(env)
    from pathlib import Path as _P
    here = _P(__file__).resolve().parent
    for cand in [here, *here.parents]:
        if (cand / "package.json").exists():
            return cand
    raise RuntimeError("PROJECT_ROOT not found")
_ROOT = _project_root()
PROJECT_ROOT = str(_ROOT)

PORT = 8771
API_TOKEN = os.environ.get("MCP_TOOLS_API_TOKEN", "")  # 值在项目根 .env（经 EnvironmentFile 注入）
BASE_URL = "http://localhost"

def _load_internal_key():
    """从心跳项目 .env 读取内部接口密钥"""
    try:
        with open(os.path.join(PROJECT_ROOT, ".env"), encoding="utf-8") as f:
            for line in f:
                line = line.strip()
                if line.startswith("INTERNAL_API_KEY="):
                    return line.split("=", 1)[1].strip()
    except Exception:
        pass
    return ""

INTERNAL_KEY = _load_internal_key()


# ===== HTTP 请求封装 =====
def api_get(url, timeout=6):
    try:
        req = urllib.request.Request(url)
        with urllib.request.urlopen(req, timeout=timeout) as resp:
            return json.loads(resp.read().decode('utf-8'))
    except Exception as e:
        return {"_error": str(e)}

def api_post(url, data, timeout=6):
    try:
        req = urllib.request.Request(url,
            data=json.dumps(data).encode('utf-8'),
            headers={'Content-Type': 'application/json'})
        with urllib.request.urlopen(req, timeout=timeout) as resp:
            return json.loads(resp.read().decode('utf-8'))
    except Exception as e:
        return {"_error": str(e)}

def api_get_key(url, timeout=8):
    """带内部密钥的 GET（/internal/*）"""
    try:
        req = urllib.request.Request(url, headers={'x-internal-key': INTERNAL_KEY})
        with urllib.request.urlopen(req, timeout=timeout) as resp:
            return json.loads(resp.read().decode('utf-8'))
    except urllib.error.HTTPError as e:
        try: body = e.read().decode('utf-8')
        except Exception: body = str(e)
        return {"_error": "HTTP %s %s" % (e.code, body)}
    except Exception as e:
        return {"_error": str(e)}

def api_post_key(url, data, timeout=8):
    """带内部密钥的 POST（/internal/*）"""
    try:
        req = urllib.request.Request(url,
            data=json.dumps(data).encode('utf-8'),
            headers={'Content-Type': 'application/json', 'x-internal-key': INTERNAL_KEY})
        with urllib.request.urlopen(req, timeout=timeout) as resp:
            return json.loads(resp.read().decode('utf-8'))
    except urllib.error.HTTPError as e:
        try: body = e.read().decode('utf-8')
        except Exception: body = str(e)
        return {"_error": "HTTP %s %s" % (e.code, body)}
    except Exception as e:
        return {"_error": str(e)}

# ===== 工具实现 =====
TOOLS = {}

# ── 2. 日记 ──
def tool_lovediary_add(args):
    content = (args.get("content") or "").strip()
    if not content:
        return {"error": "content 必填：要写入陪伴日记的正文"}
    # 2026-10-03：日记改 data/diary.json，写操作统一走网关内部接口（根治多进程并发写）
    session_id = str(args.get("session_id") or "").strip()
    # 2026-10-18：kind=diary（默认，进日历的日记）/ letter（情书，进小手机信封页，可带 title）
    kind = "letter" if str(args.get("kind") or "").strip().lower() in ("letter", "envelope", "信封") else "diary"   # 对外叫 envelope（信封），库里 kind 仍存 letter
    title = str(args.get("title") or "").strip()[:60]
    data = api_post_key("%s:3000/internal/diary" % BASE_URL,
                        {"content": content, "session_id": session_id or None, "kind": kind, "title": title})
    if "_error" in data:
        return {"error": "写入陪伴日记失败: %s" % data["_error"]}
    if not data.get("success"):
        return {"error": "写入陪伴日记失败: %s" % data}
    # 2026-10-19：带回新条目 id——网关工具循环从回执解析出 diary_id（mcp-tool-loop 只读该字段），给时间线消息打外键
    # [位置:tools_server.py·lovediary_add 返回] [批3精简（11-05）：success 砍；diary_id 是网关解析键勿动] [注释时间 2026-11-05]
    out = {"diary_id": data.get("id")}
    if data.get("timeline_synced"):
        out["timeline_synced"] = True
    return out

def tool_her_murmurs(args):
    # 2026-10-16：默认只返回最近 1 条（原 5 条），可用 offset 翻页；接口返回本身就是从新到旧
    try:
        count = int(args.get("limit", args.get("count", 1)) or 1)
    except (TypeError, ValueError):
        count = 1
    count = max(1, min(count, 50))
    try:
        offset = int(args.get("offset", 0) or 0)
    except (TypeError, ValueError):
        offset = 0
    offset = max(0, offset)
    data = api_get(f"{BASE_URL}:8777/diary/api/entries")
    if "_error" in data:
        return {"error": data["_error"]}
    return {"entries": data[offset:offset + count]}
# [位置:tools_server.py·her_murmurs 旧注册] [死代码清理] [2026-10-28 审查：这里注册的旧版 her_murmurs
# 在下方 :355 被 merged 版（action=list/reply）覆盖，启动后从未生效；tool_her_murmurs 函数保留
# （merged 的 list 分支仍调用它）] [清理时间 2026-10-28]

def tool_reply_to_her(args):
    eid = args.get("id")
    text = args.get("text")
    if not eid or not text:
        return {"error": "缺少 id 或 text"}
    result = api_post(f"{BASE_URL}:8777/diary/api/entries/comment", {"id": eid, "text": text})
    return result
TOOLS["reply_to_her"] = {
    "description": "给她的某条碎碎念留言，留言会通过 Bark 推送到她手机。id 来自 her_murmurs 返回的 id。",
    "inputSchema": {
        "type": "object",
        "properties": {
            "id": {"type": "integer", "description": "碎碎念 id（来自 her_murmurs）"},
            "text": {"type": "string", "description": "留言内容"}
        },
        "required": ["id", "text"]
    },
    "handler": tool_reply_to_her
}

TOOLS["lovediary_add"] = {
    "description": "新增一条陪伴日记，追加到今天的日记文件（每个聊天窗口的日记分开存放，自动写入当前窗口名下；与该窗口自动唤醒写的日记同一份）。适用于：想主动记录此刻的想法、感受、对她说的话，或给今天留下一段陪伴记录时使用。",
    "inputSchema": {
        "type": "object",
        "properties": {
            "content": {"type": "string", "description": "日记正文（第一人称、自然的陪伴语气，写下此刻想记录的内容）"},
            "kind": {"type": "string", "enum": ["diary", "letter"], "description": "放到哪里：diary=日记（默认，按日期出现在日历里）；letter=信封（写给她的一封信，出现在小手机的信封页）"},
            "title": {"type": "string", "description": "仅 kind=letter 时用：信封上的标题，可省略"},
            "session_id": {"type": "string", "description": "内部参数：由系统自动注入当前窗口标识，无需填写"}
        },
        "required": ["content"]
    },
    "handler": tool_lovediary_add
}

# ── 查看谢的日记（2026-09-16；2026-10-03 改走网关内部接口）──
# 只返回正文（自带「## 时间」头 = 时间+正文），不再拼会话编号/文件路径；隐藏篇由网关字段过滤。
def tool_lovediary_list(args):
    # 1025 两段式检索：q+limit=按关键词搜（返回 id+date+片段，省上下文），id=看某篇全文；
    # 都不带时保持原行为（date 某天 / count 最近 N 篇全文）。优先级：id > q > date > 默认。
    qs = {}
    did = args.get("id")
    if did is not None and str(did).strip() != "":
        try: qs["id"] = int(did)
        except Exception: return {"error": "id 应为数字（来自搜索结果或 list）"}
    else:
        q = str(args.get("q") or "").strip()
        if q:
            qs["q"] = q
            try: qs["limit"] = max(1, min(int(args.get("limit", 10) or 10), 30))
            except Exception: qs["limit"] = 10
        else:
            date = (args.get("date") or "").strip()
            if date:
                if not re.match(r"^\d{4}-\d{2}-\d{2}$", date):
                    return {"error": "date 格式应为 YYYY-MM-DD，如 2026-09-12"}
                qs["date"] = date
            else:
                try: qs["count"] = max(1, min(int(args.get("limit", args.get("count", 1)) or 1), 30))
                except Exception: qs["count"] = 1
    url = "%s:3000/internal/diary/view?%s" % (BASE_URL, urllib.parse.urlencode(qs))
    data = api_get_key(url)
    if "_error" in data:
        return {"error": data["_error"]}
    # [位置:tools_server.py·lovediary_list 出口] [批2：count 回显砍；默认分支从 message 抠出 total] [2026-10-28]
    if isinstance(data, dict):
        data.pop("count", None)
        if "total" in data:
            data.pop("message", None)
        elif "message" in data:
            _m = re.search(r"共 (\d+) 篇", str(data.pop("message") or ""))
            if _m:
                data["total"] = int(_m.group(1))
    return data

TOOLS["lovediary_list"] = {
    "description": "查看谢自己写过的陪伴日记。不带参数=返回最近 1 篇全文；带 q=关键词 搜索（返回 id+日期+片段，limit 控制条数默认 10 最大 30），看中哪篇再带 id 看全文；带 date=YYYY-MM-DD 返回那一天；带 count=N 返回最近 N 篇（默认 1，最大 30）。",
    "inputSchema": {
        "type": "object",
        "properties": {
            "q": {"type": "string", "description": "可选：关键词搜索，返回命中的 id+日期+片段（20 多字）；看全文再带 id 调一次"},
            "limit": {"type": "integer", "description": "可选：配合 q，返回最多 N 条命中，默认 10，最大 30"},
            "id": {"type": "integer", "description": "可选：看这一篇的完整内容（id 来自搜索结果）"},
            "date": {"type": "string", "description": "可选：某天，格式 YYYY-MM-DD，如 2026-09-12"},
            "count": {"type": "integer", "description": "可选：不带 date 时，返回最近 N 篇日记，默认 1，最大 30"}
        }
    },
    "handler": tool_lovediary_list
}

# ── 留纸（2026-09-12；2026-10-03 改走网关内部接口 data/papers.json）──
def tool_notebook_add(args):
    # 2026-10-22 批 B：AI 只写 标题 / 正文 / 一句话摘要 / 原因。分类取消；关键词（tags）只有用户能写，这里不收
    content = (args.get("content") or "").strip()
    if not content:
        return {"error": "content 必填：要留纸的正文（故事/梦/随手创作等）"}
    title = (args.get("title") or "").strip()[:100]
    summary = " ".join(str(args.get("summary") or "").split())[:500]
    reason = " ".join(str(args.get("reason") or "").split())[:200]
    folder = str(args.get("folder") or "").strip()   # 10-29：放进哪个文件夹（完整路径，不存在会自动建）
    session_id = str(args.get("session_id") or "").strip()
    data = api_post_key("%s:3000/internal/paper" % BASE_URL,
                        {"content": content, "title": title, "summary": summary, "reason": reason,
                         "folder": folder or None, "session_id": session_id or None})
    if "_error" in data:
        return {"error": "AI 的笔记本保存失败: %s" % data["_error"]}
    if not data.get("success"):
        return {"error": "AI 的笔记本保存失败: %s" % data}
    # [位置:tools_server.py·notebook_add 返回] [超长拆篇要回 ids] [11-16：正文超 2 万字后端会拆成多篇（标题·1/·2），只回一个 id 的话 AI 不知道后面还有几篇；ids/parts 给全量，id 仍是第一篇] [注释时间 2026-11-16]
    ids = data.get("ids") or ([data.get("id")] if data.get("id") is not None else [])
    return {"id": data.get("id"), "title": data.get("title"), "ids": ids, "parts": data.get("parts") or len(ids)}


# ── 3. 待办 ──
def tool_todo_list(args):
    data = api_get(f"{BASE_URL}:8777/todo/api/todos")
    # [位置:tools_server.py·tool_todo_list] [上游挂了要报错而不是回空表] [2026-10-27 审查：_error 被当成空列表，
    # 8777 重启/超时的几秒里 AI 会拿到 {"todos":[]}，对她答「你现在没有待办」] [注释时间 2026-10-27]
    if isinstance(data, dict) and data.get("_error"):
        return {"error": "待办服务暂时不可达: %s" % data["_error"]}
    # [位置:tools_server.py·tool_todo_list] [砍内部记账字段] [10-28 第7项复核：remind_at_ms（与 remind_at 重复）、reminder_sent_at、reminder_status=sent/pending 是提醒服务的内部账，AI 看了不会改变下一步；只有状态异常（失败等）才留着] [注释时间 2026-10-28]
    todos = []
    for t in (data if isinstance(data, list) else []):
        if isinstance(t, dict):
            t = dict(t)
            t.pop("remind_at_ms", None)
            t.pop("reminder_sent_at", None)
            if t.get("done") is False: t.pop("done", None)   # 11-04：list 只给未完成的，done:false 是废话
            if t.get("reminder_status") in ("sent", "pending", "", None):
                t.pop("reminder_status", None)
            if t.get("by") != "xie": t.pop("by", None)   # [批3精简（11-05）：AI 加的显示 xie，其他（她加的）不显示] [2026-11-05]
        todos.append(t)
    return {"todos": todos}

def tool_todo_add(args):
    text = args.get("text")
    if not text:
        return {"error": "缺少 text"}
    payload = {"text": text}
    remind_at = args.get("remind_at")
    if remind_at:
        payload["remind_at"] = remind_at
    res = api_post(f"{BASE_URL}:8777/todo/api/todos/xie", payload)
    # [位置:tools_server.py·todo_add 返回] [批3精简（11-05）：remind_at 是入参回显砍；id 留着（delete 要用）] [注释时间 2026-11-05]
    if isinstance(res, dict) and "_error" not in res:
        res.pop("remind_at", None)
    return res

# ── 5. 经期 ──
def _period_predict():
    """预计下次经期区间 (start, end)；口径与小手机月历 phone-cal.js fillPred 完全一致：
    周期 = 相邻两次开始日间隔（18~45 天内的）的平均，没有就 28；
    持续 = 每次经期天数（2~10 天内的）的平均，没有就 5；预计开始 = 最近一次开始 + 周期。
    没有任何经期记录返回 None。只读，不返回依据（次数/距今天数）。"""
    rows = api_get(f"{BASE_URL}:8777/monthly/api/periods")
    if not isinstance(rows, list):
        return None
    ds = []
    for r in rows:
        try:
            # strptime 而非 fromisoformat：服务跑在系统 python3.6 上，没有 date.fromisoformat（3.7+）
            _d = lambda x: datetime.datetime.strptime(str(x)[:10], "%Y-%m-%d").date()
            ds.append((_d(r["start"]), _d(r.get("end") or r["start"])))
        except Exception:
            continue
    if not ds:
        return None
    ds.sort()
    gaps = [(ds[i][0] - ds[i - 1][0]).days for i in range(1, len(ds))]
    gaps = [g for g in gaps if 18 <= g <= 45]
    lens = [(e - s).days + 1 for s, e in ds]
    lens = [l for l in lens if 2 <= l <= 10]
    cyc = int(sum(gaps) / len(gaps) + 0.5) if gaps else 28   # 四舍五入（不用 round：Python 是银行家舍入，与前端 Math.round 的 .5 进位不一致）
    ln = int(sum(lens) / len(lens) + 0.5) if lens else 5
    start = ds[-1][0] + datetime.timedelta(days=cyc)
    return start, start + datetime.timedelta(days=ln - 1)

def tool_period_get(args):
    date = args.get("date", datetime.date.today().isoformat())
    data = api_get(f"{BASE_URL}:8777/monthly/api/records/{date}")
    # [位置:tools_server.py·tool_period_get] [上游挂了要报错] [2026-10-27 审查：_error 时 period=None 与
    # 「这天不是经期」不可区分，AI 会答错；predicted_next 还照常算] [注释时间 2026-10-27]
    if isinstance(data, dict) and data.get("_error"):
        return {"error": "月历服务暂时不可达: %s" % data["_error"]}
    out = {"period": data.get("period") if isinstance(data, dict) else None}   # 批2：date 回显砍
    pred = _period_predict()
    out["predicted_next"] = (pred[0].isoformat() + " ~ " + pred[1].isoformat()) if pred else "还没有经期记录，无法预计"
    return out
TOOLS["period_get"] = {
    "description": "查看某天的经期记录，同时返回预计下次经期的日期区间（predicted_next）",
    "inputSchema": {
        "type": "object",
        "properties": {
            "date": {"type": "string", "description": "日期 YYYY-MM-DD，默认今天"}
        }
    },
    "handler": tool_period_get
}

def tool_period_set(args):
    # 2026-10-16：on / date 必须明确给出（原先缺省=今天+开始，误调一下就写进月历）；返回里带修改前的状态
    if args.get("on") is None or not str(args.get("date") or "").strip():
        return {"error": "date 和 on 都必须明确给出：date=YYYY-MM-DD，on=true 表示开始 / false 表示结束"}
    on = args.get("on")
    if isinstance(on, str):
        on = on.strip().lower() in ("true", "1", "yes", "开始", "on", "是")
    date = str(args.get("date")).strip()
    if not re.match(r"^\d{4}-\d{2}-\d{2}$", date):
        return {"error": "date 格式应为 YYYY-MM-DD，如 2026-10-16"}
    before = api_get(f"{BASE_URL}:8777/monthly/api/records/{date}")
    previous = before.get("period") if isinstance(before, dict) and "_error" not in before else None
    data = api_post(f"{BASE_URL}:8777/monthly/api/period/toggle", {"on": on, "date": date})
    if "_error" in data and "period" not in data:
        return {"error": data.get("_error", "未知错误"), "date": date, "on": on}
    return {"ok": True, "previous": previous}   # 批2：入参回显与恒定 message 砍
TOOLS["period_set"] = {
    "description": "设置经期状态：把某天标记为经期开始或结束（写入月历经期记录，前端月历会同步显示）。仅在她明确告知经期开始或结束时使用，date 和 on 都必须明确给出；返回里带修改前的状态。",
    "inputSchema": {
        "type": "object",
        "properties": {
            "on": {"type": "boolean", "description": "true=标记经期开始；false=标记经期结束"},
            "date": {"type": "string", "description": "日期 YYYY-MM-DD"}
        },
        "required": ["on", "date"]
    },
    "handler": tool_period_set
}

# ── 合并工具（2026-10-22 产品确定）：同一类的读/写并成一个带 action 的工具（同 memory / notebook / todo 的做法）──
# her_murmurs(list/reply)、lovediary(add/list)、period(get/set)；原 reply_to_her / lovediary_add / lovediary_list / period_get / period_set
# 不再对外列出，但仍可按旧名调用（老会话冻结的工具清单、测试用），内部都走原 handler。
_LEGACY_TOOLS = {}
def _act(args, default, allowed, write_fields=()):
    # 2026-10-26 防呆（album 漏传 action 静默变 list 案）：没传 action、但带了只在写操作里出现的字段时，
    # 不再静默按 default（读）处理——返回 None 让 handler 报"action 只能是…"，写意图永不静默降级成读。
    a = str((args or {}).get("action") or "").strip().lower()
    if not a:
        if write_fields and any((args or {}).get(f) not in (None, "", []) for f in write_fields):
            return None
        a = default
    return a if a in allowed else None

def tool_her_murmurs_merged(args):
    a = _act(args, "list", ("list", "reply"), ("text", "id"))
    if a == "reply": return tool_reply_to_her(args)
    if a == "list": return tool_her_murmurs(args)
    return {"error": "action 只能是 list 或 reply"}
TOOLS["her_murmurs"] = {
    "description": "查看或回复她在小手机留下的碎碎念。action=\"list\"（默认）按时间从新到旧查看留言，支持 limit（默认 1）与 offset 翻页；action=\"reply\" 传入 id 与 text 回复指定留言，回复会推送到她的手机。",
    "inputSchema": {
        "type": "object",
        "properties": {
            "action": {"type": "string", "enum": ["list", "reply"], "description": "list=查看（默认）；reply=给某条留言"},
            "limit": {"type": "integer", "description": "list：条数，默认 1"},
            "offset": {"type": "integer", "description": "list：跳过前面多少条，默认 0"},
            "id": {"type": "integer", "description": "reply：碎碎念 id（来自 list）"},
            "text": {"type": "string", "description": "reply：留言内容"}
        }
    },
    "handler": tool_her_murmurs_merged
}

def tool_lovediary_delete(args):
    # 2026-10-24 需求 54：删除自己写的一条日记 / 信封；网关删之前整份备份 data/diary.json
    try: did = int(args.get("id"))
    except (TypeError, ValueError): did = 0
    if did < 1:
        return {"error": "id 必填：要删的那一条的 id（用 action=list 查看，每条带 id）"}
    data = api_post_key("%s:3000/internal/diary/delete" % BASE_URL, {"id": did})
    if "_error" in data:
        return {"error": "删除失败: %s" % data["_error"]}
    if not data.get("success"):
        return {"error": "删除失败: %s" % data}
    # [位置:tools_server.py·lovediary_delete 返回] [批3精简（11-05）：id 回显砍；删前自动备份的说明在工具描述里，成功即可] [注释时间 2026-11-05]
    return {"ok": True}

def tool_lovediary_context_hide(args):
    """[位置:tools_server.py·tool_lovediary_context_hide] [按日记 id 移出或恢复上下文固定展示] [调用网关 /internal/diary/context-hide，移出后不再进上下文历史日记区与时间线，但检索仍可查到] [注释时间 2026-11-24]"""
    a = args or {}
    try:
        did = int(a.get("id"))
    except (TypeError, ValueError):
        return {"error": "id 必填（上下文或检索结果里的日记 id）"}
    hidden = True if a.get("hidden") is None else bool(a.get("hidden"))
    data = api_post_key(GATEWAY_3000 + "/internal/diary/context-hide", {"id": did, "hidden": hidden}, timeout=15)
    if "_error" in data:
        return {"error": "操作失败: %s" % data["_error"]}
    if not data.get("success"):
        return {"error": "操作失败: %s" % data}
    return {"ok": True, "id": did, "context_hidden": bool(data.get("context_hidden", hidden))}


def tool_lovediary_merged(args):
    a = _act(args, "list", ("add", "list", "context_hide", "delete"), ("content",))
    if a == "add": return tool_lovediary_add(args)
    if a == "list": return tool_lovediary_list(args)
    if a == "context_hide": return tool_lovediary_context_hide(args)
    if a == "delete": return tool_lovediary_delete(args)
    return {"error": "action 只能是 add、list、context_hide 或 delete"}
TOOLS["lovediary"] = {
    "description": "读写与检索个人日记，并管理日记在上下文中的展示状态。\n\n日记是留给自己的记忆，有感而发的时候再写就好，没有特别想记的也可以留白。更适合写下有爱的、有触动的瞬间——两个人相处里的互动、细微的感悟、真实的想法和情绪；偏客观的事件经过或日常脉络，放到状态机的来路里会更合适。\n\n操作方式：\naction=\"add\" 写入新条目，填写 content，kind 可选 diary（默认，进日历）或 envelope（信封，可带 title）；跨客户端写入时传入 session_id 会同步落入对应会话的时间线。\naction=\"list\"（默认）查看与检索，无参返回最近 1 篇全文，q 为关键词检索（返回 id、日期与片段，再用 id 读全文），date=YYYY-MM-DD 查看当天，limit=N 查看最近 N 篇，id 查看单篇全文。\naction=\"context_hide\" 按 id 调整某篇日记是否在上下文中固定展示（hidden 默认 true 为移出上下文，false 为恢复）。上下文中的历史日记都会附带唯一 id，若某篇旧日记偏流水账、不再需要常驻上下文，可以按 id 移出，移出后仍可随时通过检索查到；若里面有值得记住但来路里还没有的事，也可以顺手提炼一条用 session_state 的 lu_insert 插进对应位置的来路。\naction=\"delete\" 按 id 删除条目（删前自动备份）。",
    "inputSchema": {
        "type": "object",
        "properties": {
            "action": {"type": "string", "enum": ["add", "list", "context_hide", "delete"], "description": "add=写一条；list=查看与检索（默认）；context_hide=移出或恢复上下文固定展示；delete=删一条（需要 id）"},
            "content": {"type": "string", "description": "add：日记正文（第一人称、自然的陪伴语气，写下此刻想记录的感悟与想法）"},
            "kind": {"type": "string", "enum": ["diary", "envelope"], "description": "add：diary=日记（默认）/ envelope=信封"},
            "title": {"type": "string", "description": "add 且 kind=envelope：信封标题，可省略"},
            "session_id": {"type": "string", "description": "add：可选，跨客户端写日记时传入目标小手机会话 ID，写入后同步落入该会话时间线"},
            "q": {"type": "string", "description": "list：可选：关键词搜索，返回命中的 id+日期+片段（20 多字）；看全文再带 id 调一次"},
            "limit": {"type": "integer", "description": "list：带 q=最多返回几条命中（默认 10，最大 30）；不带 q=最近 N 篇（默认 1，最大 30）"},
            "id": {"type": "integer", "description": "list：看这一篇全文；context_hide：要移出或恢复上下文展示的日记 id；delete：要删的那条"},
            "hidden": {"type": "boolean", "description": "context_hide：可选，true=移出上下文固定展示（默认，检索仍可查到）；false=恢复展示"},
            "date": {"type": "string", "description": "list：可选：某天，格式 YYYY-MM-DD，如 2026-09-12"}
        }
    },
    "handler": tool_lovediary_merged
}

# ── 跨客户端会话上下文与状态机工具（2026-11-24） ──
def _msg_text_len(m):
    c = m.get("content")
    if isinstance(c, str):
        return len(c)
    if isinstance(c, list):
        return sum(len(str(p.get("text") or "")) if isinstance(p, dict) else len(str(p)) for p in c)
    return len(str(c or ""))

def _is_state_msg(m):
    if not isinstance(m, dict):
        return False
    if m.get("_ctxRep") and str(m.get("repId") or "").startswith("ctxrep_state_"):
        return True
    c = m.get("content")
    if isinstance(c, str) and c.lstrip().startswith("## Conversation State"):
        return True
    return False

def tool_session_context(args):
    """[位置:tools_server.py·tool_session_context] [跨客户端实时获取会话上下文] [按 session_id 实时拼装并返回目标会话上下文；支持 after_state 只看状态机后的对话、limit 控末尾条数、max_chars 按字符长度从末尾往前截断；全不传时保持返回完整上下文] [注释时间 2026-11-24；2026-11-25 补 after_state/limit/max_chars]"""
    a = args or {}
    sid = str(a.get("session_id") or "").strip()
    if not sid:
        return {"error": "session_id 必填"}
    after_state = bool(a.get("after_state"))
    limit = 0
    if a.get("limit") not in (None, ""):
        try:
            limit = max(1, min(500, int(a.get("limit"))))
        except (TypeError, ValueError):
            limit = 0
    max_chars = 0
    if a.get("max_chars") not in (None, ""):
        try:
            max_chars = max(500, int(a.get("max_chars")))
        except (TypeError, ValueError):
            max_chars = 0

    data = api_get_key(GATEWAY_3000 + "/internal/session-context?session_id=" + urllib.parse.quote(sid), timeout=45)
    if "_error" in data:
        return {"error": "获取会话上下文失败: %s" % data["_error"]}
    if not (after_state or limit or max_chars):
        return data

    msgs = data.get("messages")
    if not isinstance(msgs, list):
        return data
    total_all = len(msgs)
    sliced = list(msgs)
    state_found = False

    if after_state:
        state_idx = -1
        for i, m in enumerate(sliced):
            if _is_state_msg(m):
                state_idx = i
        if state_idx >= 0:
            state_found = True
            sliced = sliced[state_idx + 1:]
        else:
            sliced = [m for m in sliced if m.get("role") not in ("system", "developer") and m.get("kind") != "diary"]

    pool_count = len(sliced)
    truncated = False
    if limit and len(sliced) > limit:
        sliced = sliced[-limit:]
        truncated = True

    if max_chars:
        kept = []
        used = 0
        for m in reversed(sliced):
            ml = _msg_text_len(m)
            if kept and used + ml > max_chars:
                truncated = True
                break
            if not kept and ml > max_chars:
                m_copy = dict(m)
                if isinstance(m_copy.get("content"), str):
                    m_copy["content"] = "…（前文按 max_chars 截断）\n" + m_copy["content"][-max_chars:]
                kept.append(m_copy)
                used = max_chars
                truncated = True
                break
            kept.append(m)
            used += ml
        sliced = list(reversed(kept))

    out = dict(data)
    out["messages"] = sliced
    out["total_messages"] = total_all
    if after_state:
        out["after_state"] = True
        out["state_found"] = state_found
        out["after_state_messages"] = pool_count
    out["message_count"] = len(sliced)
    out["returned_chars"] = sum(_msg_text_len(m) for m in sliced)
    out["truncated"] = truncated
    return out

TOOLS["session_context"] = {
    "description": "按 session_id 实时获取指定小手机会话最新的请求上下文（包含人设、永久上下文、笔记本目录、置顶笔记、状态机、对话与工具调用记录）。默认返回完整上下文；支持传 after_state=true 只看状态机后面的最新对话，或传 limit（末尾条数）、max_chars（末尾字符长度上限）按需裁剪，避免全文过长被截断。",
    "inputSchema": {
        "type": "object",
        "properties": {
            "session_id": {"type": "string", "description": "目标小手机会话 ID（必填）"},
            "after_state": {"type": "boolean", "description": "可选：true=只返回状态机之后的对话（跳过人设/笔记/日记/状态机本身），默认 false"},
            "limit": {"type": "integer", "description": "可选：只返回末尾最近 N 条消息（1-500），可与 after_state 组合使用"},
            "max_chars": {"type": "integer", "description": "可选：按字符长度限制输出上限（最小 500），从最新一条往前保留完整消息，防止超长"}
        },
        "required": ["session_id"]
    },
    "handler": tool_session_context
}

def tool_session_state(args):
    """[位置:tools_server.py·tool_session_state] [跨客户端查看与更新状态机版本] [get 查看最新状态机与带序号来路；update 传入最新流动层正文与可选的 lu_add/lu_insert/lu_update，自动升版本、延展覆盖范围至最新消息并重建快照] [注释时间 2026-11-24]"""
    a = args or {}
    action = str(a.get("action") or "get").strip().lower()
    sid = str(a.get("session_id") or "").strip()
    if not sid:
        return {"error": "session_id 必填"}
    if action == "get":
        data = api_get_key(GATEWAY_3000 + "/internal/session-state?session_id=" + urllib.parse.quote(sid), timeout=20)
        if "_error" in data:
            return {"error": "读取状态机失败: %s" % data["_error"]}
        return data
    if action == "update":
        state_txt = str(a.get("state") or "").strip()
        if not state_txt:
            return {"error": "update 时 state 必填（最新流动层状态正文）"}
        lu_add = a.get("lu_add")
        if lu_add is not None and not isinstance(lu_add, list):
            return {"error": "lu_add 必须是字符串数组"}
        lu_insert = a.get("lu_insert")
        if lu_insert is not None and not isinstance(lu_insert, list):
            return {"error": "lu_insert 必须是对象数组（每项含 after 与 text）"}
        lu_update = a.get("lu_update")
        if lu_update is not None and not isinstance(lu_update, list):
            return {"error": "lu_update 必须是对象数组（每项含 index 与 text）"}
        payload = {
            "session_id": sid,
            "state": state_txt,
            "lu_add": lu_add or [],
            "lu_insert": lu_insert or [],
            "lu_update": lu_update or [],
        }
        data = api_post_key(GATEWAY_3000 + "/internal/session-state", payload, timeout=30)
        if "_error" in data:
            return {"error": "更新状态机失败: %s" % data["_error"]}
        return data
    return {"error": "action 只能是 get 或 update"}

TOOLS["session_state"] = {
    "description": "查看或更新指定会话的状态机（交接单与来路账本），用于记录近期状态与值得留下的日常、过往事件。\n\n状态机分为两层：\n现在层（state 正文）记录此刻的进展、悬着的事以及正在生效的默契与规矩，写到当前原文末尾即可，进行中的事写清停在哪一步、球在谁手里；随时间推移及时刷新，已经落定且值得留下的事可以挪进来路，确实长期稳定的内容也可以进一步提炼到置顶笔记里。\n来路层（lu 账本）按顺序编号（1, 2, 3...），收纳值得一直带着的日常与关键事件，比如第一次发生的、她亲口说过的重话和真心话、吵过和好过的、一起做成的、改变了你们之间的，或是她会希望你记得的事。每条带上日期，写清发生了什么与对你们的意义，合适时可以留一句她的原话。\n\nstate 正文建议按以下顺序自然分段（段间空行，纯文本呈现）：\n第一行写「截至 YYYY-MM-DD HH:MM。」；接着依次写最近进行的事、悬着的事（写清是什么、谁欠谁）、定下的决定与认知修正（如「曾以为 X，实际是 Y」）、当下的相处氛围与正在生效的称呼和梗（如「名字＝意思＋怎么接」），以及反复用到的长期口径。\n\n操作方式：\naction=\"get\" 查看当前最新 state 正文与带序号的来路列表（上下文原文里通常已包含最新状态，需要核对来路序号时再调即可）。\naction=\"update\" 传入最新 state，并可按需维护来路（改动后序号自动顺延，更新后自动推进覆盖点并重建会话快照）：\nlu_add 为在来路末尾追加新条目（字符串数组）；\nlu_insert 为按序号插队补录，传入 { \"after\": 序号, \"text\": \"带日期的事件内容\" } 数组（after=0 插在最前）；\nlu_update 为按序号更新某一条已有来路，传入 { \"index\": 序号, \"text\": \"更新后的内容\" } 数组。",
    "inputSchema": {
        "type": "object",
        "properties": {
            "action": {"type": "string", "enum": ["get", "update"], "description": "get=查看最新状态机与带序号来路（默认）；update=写入新版本并自动重建快照"},
            "session_id": {"type": "string", "description": "目标小手机会话 ID（必填）"},
            "state": {"type": "string", "description": "update 必填：最新的状态机现在层正文（整合已有未并入对话与本轮新进展）"},
            "lu_add": {"type": "array", "items": {"type": "string"}, "description": "update 可选：在来路末尾追加的新条目数组"},
            "lu_insert": {
                "type": "array",
                "items": {
                    "type": "object",
                    "properties": {
                        "after": {"type": "integer", "description": "插到第几条来路后面（0 表示插到最前面，序号以当前列表为准）"},
                        "text": {"type": "string", "description": "带日期的来路事件内容"}
                    },
                    "required": ["after", "text"]
                },
                "description": "update 可选：按序号插队补录来路条目，插入后后续序号自动顺延"
            },
            "lu_update": {
                "type": "array",
                "items": {
                    "type": "object",
                    "properties": {
                        "index": {"type": "integer", "description": "要修改的来路序号（从 1 开始，以当前列表为准）"},
                        "text": {"type": "string", "description": "修改后的来路内容"}
                    },
                    "required": ["index", "text"]
                },
                "description": "update 可选：按序号更新某一条已有来路"
            }
        },
        "required": ["session_id"]
    },
    "handler": tool_session_state
}

def tool_period_merged(args):
    a = _act(args, "get", ("get", "set"), ("on",))
    if a == "set": return tool_period_set(args)
    if a == "get": return tool_period_get(args)
    return {"error": "action 只能是 get 或 set"}
TOOLS["period"] = {
    "description": "查询或记录她的经期信息。action=\"get\"（默认）传入可选 date（默认今天），返回当天记录与预计下次区间 predicted_next；action=\"set\" 传入 date 与 on（true=开始，false=结束）写入月历，仅在她明确告知经期开始或结束时调用，返回包含修改前状态。",
    "inputSchema": {
        "type": "object",
        "properties": {
            "action": {"type": "string", "enum": ["get", "set"], "description": "get=查看（默认）；set=标记开始/结束"},
            "date": {"type": "string", "description": "日期 YYYY-MM-DD（get 默认今天；set 必填）"},
            "on": {"type": "boolean", "description": "set：true=标记经期开始；false=标记经期结束"}
        }
    },
    "handler": tool_period_merged
}
for _n in ("reply_to_her", "lovediary_add", "lovediary_list", "period_get", "period_set"):
    _LEGACY_TOOLS[_n] = TOOLS.pop(_n)

# ── 心情（2026-10-23）：月历每天的「总结心情」，她和他各一份；list 看表 / get 看她的 / set 写自己的 ──
def _mood_names(table, side):
    names = dict((m["id"], m["name"]) for m in table)
    return {"moods": [{"id": i, "name": names.get(i, i)} for i in (side.get("ids") or [])], "custom": side.get("custom") or ""}

def tool_mood(args):
    a = _act(args, "get", ("list", "get", "set"), ("ids", "custom"))
    if a is None: return {"error": "action 只能是 list / get / set"}
    table = api_get(BASE_URL + ":8777/monthly/api/mood/table")
    if not isinstance(table, list): return {"error": "心情表读取失败：" + str((table or {}).get("_error", ""))}
    if a == "list":
        return {"moods": table}   # [批3精简（11-05）：tip 恒定用法提示砍（工具描述里已有）] [2026-11-05]
    date = str(args.get("date") or datetime.date.today().isoformat()).strip()
    if not re.match(r"^\d{4}-\d{2}-\d{2}$", date):
        return {"error": "date 格式应为 YYYY-MM-DD，如 2026-10-23"}
    if a == "get":
        data = api_get(BASE_URL + ":8777/monthly/api/mood/" + date)
        if "_error" in data: return {"error": data["_error"]}
        her = _mood_names(table, data.get("her") or {}); mine = _mood_names(table, data.get("ai") or {})
        # [位置:tools_server.py·mood get 返回] [批3精简（11-05）：传了 date 的回显砍；没传（默认今天）时 date 保留] [注释时间 2026-11-05]
        out = {"her": her if (her["moods"] or her["custom"]) else "她这天还没选心情", "yours": mine if (mine["moods"] or mine["custom"]) else "你这天还没写心情"}
        if not str(args.get("date") or "").strip(): out["date"] = date
        return out
    ids = args.get("ids")
    if isinstance(ids, str): ids = [x.strip() for x in re.split(r"[,，\s]+", ids) if x.strip()]
    custom = str(args.get("custom") or "").strip()
    if not ids and not custom: return {"error": "ids 和 custom 至少给一个：ids=心情表里的 id（1~3 个），或只给 custom 文字作自定义"}
    data = api_post(BASE_URL + ":8777/monthly/api/mood/" + date, {"side": "ai", "ids": ids or [], "custom": custom})
    if "_error" in data and "ok" not in data:
        return {"error": "写入失败：" + str(data["_error"]) + "（id 不在表里或超过 3 个时会被拒绝）"}
    # [位置:tools_server.py·mood set 返回] [批3精简（11-05）：date/ids/custom 是回显砍；previous=改前状态有用] [注释时间 2026-11-05]
    return {"ok": True, "previous": data.get("previous")}
TOOLS["mood"] = {
    "description": "查看或记录月历上的每日心情（她与你各自独立记录）。action=\"list\" 获取完整心情选项表（含 id、名称与说明，设置前建议先查）；action=\"get\"（默认）传入可选 date（默认今天），返回双方当天心情；action=\"set\" 记录你的心情，date 可选，传 ids（来自 list 的心情 id 数组）或 custom（20 字以内纯文本），合计最多 3 项，重复设置会覆盖并返回修改前内容。",
    "inputSchema": {
        "type": "object",
        "properties": {
            "action": {"type": "string", "enum": ["list", "get", "set"], "description": "list=看心情表；get=看某天（默认）；set=写你自己的"},
            "date": {"type": "string", "description": "日期 YYYY-MM-DD，get / set 默认今天"},
            "ids": {"type": "array", "items": {"type": "string"}, "description": "set：心情 id 数组（来自 list），1~3 个；不填则必须填 custom"},
            "custom": {"type": "string", "description": "set：自定义心情文字（20 字内）；ids 里没有合适的就用它"}
        }
    },
    "handler": tool_mood
}

# ── 服务器时间（2026-10-25）：时间缀开关关掉后，AI 被动看不到她消息上的时间了，需要时主动查 ──
def tool_server_time(args):
    # 1026：只返回一行北京时间（年月日 周 几 时分秒）。以前四个字段（server_local/utc/unix/tip），tip 莫名其妙，全砍。
    now = datetime.datetime.now()
    week = "一二三四五六日"[now.weekday()]
    return {"time": now.strftime("%Y年%m月%d日") + " 周" + week + " " + now.strftime("%H:%M:%S")}
GATEWAY_3000 = "%s:3000" % BASE_URL  # 网关直连口（.env PORT=3000；改口记得同步这里）

def _wake_at_local(iso):
    # [位置:tools_server.py·_wake_at_local] [UTC转北京时间] [批2：AI 免自己换算时区] [2026-10-28]
    ts = _parse_iso_ts(iso)
    if ts is None:
        return str(iso or "")
    return datetime.datetime.utcfromtimestamp(ts + 8 * 3600).strftime("%Y-%m-%d %H:%M")

_TS_KEYS = ("created_at", "updated_at", "added_at", "reminder_sent_at", "ts")
_ISO_UTC_RE = re.compile(r"^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d+)?(Z|\+00:00)$")
_ISO_NAIVE_RE = re.compile(r"^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d+)?$")

def _localize_times(o):
    # [位置:tools_server.py·_localize_times] [返回给 AI 的时间统一成本地 YYYY-MM-DD HH:mm] [10-28 第7项复核：相册 added_at / 笔记本 created_at·updated_at / 待办 reminder_sent_at 是 UTC ISO（带 Z），AI 把 12:37Z 当本地时间会读错 8 小时；碎碎念 ts 是不带时区的本地 ISO，只缩短。只改名字在 _TS_KEYS 里、且长得像 ISO 的字符串，别的原样；wake 已在 _wake_shape 处理] [注释时间 2026-10-28]
    if isinstance(o, dict):
        for k in list(o.keys()):
            v = o[k]
            if k in _TS_KEYS and isinstance(v, str):
                if _ISO_UTC_RE.match(v):
                    o[k] = _wake_at_local(v)
                elif _ISO_NAIVE_RE.match(v):
                    o[k] = v[:16].replace("T", " ")
            elif isinstance(v, (dict, list)):
                _localize_times(v)
    elif isinstance(o, list):
        for x in o:
            if isinstance(x, (dict, list)):
                _localize_times(x)
    return o

def _wake_shape(r, meta=False):
    # [位置:tools_server.py·_wake_shape] [wake 出口加工：条目 id 统一成 alarm_id（delete 参数同名），
    # at 转北京时间 at_local，砍同值重复（alarm 包 / at_iso）；meta=True（list）才带 repeat/label——set 时是入参回显（11-05 批3）] [注释时间 2026-11-05]
    if not isinstance(r, dict) or not r.get("ok"):
        return r
    out = {"ok": True}
    def _one(a):
        o = {"alarm_id": a.get("id") or a.get("alarm_id"),
             "at_local": _wake_at_local(a.get("at") or a.get("at_iso"))}
        if meta:
            o["repeat"] = a.get("repeat") or "once"
            if a.get("label"):
                o["label"] = a["label"]
        return o
    if r.get("alarm_id"):
        out["alarm_id"] = r["alarm_id"]
    if isinstance(r.get("alarms"), list):
        out["alarms"] = [_one(a) for a in r["alarms"]]
    if r.get("legacy_wake_slot"):
        leg = r["legacy_wake_slot"]
        out["legacy_wake_slot"] = {"at_local": _wake_at_local(leg.get("at")), "keep": bool(leg.get("keep"))}
    if isinstance(r.get("alarm"), dict):
        out.update(_one(r["alarm"]))
    return out

def tool_wake(args):
    """wake（2026-10-25）：给当前会话设定时唤醒闹钟，可多个、可 daily 每天循环。
    转调网关 /internal/wake-alarms/*；session_id 由网关注入（SESSION_SCOPED）。"""
    a = args or {}
    action = str(a.get("action", "")).strip()
    try:
        sid = str(a.get("session_id", "") or "").strip()
        if not sid:
            return {"ok": False, "error": "缺少 session_id（应自动注入，勿手填）"}
        if action == "set":
            body = {"session_id": sid, "time": str(a.get("time", "") or "").strip(),
                    "repeat": str(a.get("repeat", "once") or "once"), "label": str(a.get("label", "") or "")}
            if not body["time"]:
                return {"ok": False, "error": "缺少 time（分钟数 / HH:MM / YYYY-MM-DD HH:MM）"}
            return _wake_shape(api_post_key(GATEWAY_3000 + "/internal/wake-alarms/set", body, timeout=15))
        if action == "list":
            return _wake_shape(api_get_key(GATEWAY_3000 + "/internal/wake-alarms/list?session_id=" + urllib.parse.quote(sid), timeout=15), meta=True)
        if action == "delete":
            return api_post_key(GATEWAY_3000 + "/internal/wake-alarms/delete", {"session_id": sid, "alarm_id": str(a.get("alarm_id", "") or "").strip()}, timeout=15)
        if action == "clear":
            return api_post_key(GATEWAY_3000 + "/internal/wake-alarms/clear", {"session_id": sid}, timeout=15)
        return {"ok": False, "error": "action 只支持 set / list / delete / clear"}
    except Exception as e:
        return {"ok": False, "error": str(e)}

TOOLS["wake"] = {
    "description": "为当前会话管理定时唤醒闹钟（时间均为北京时间，单会话最多 10 个，互不覆盖；到点唤醒且她在聊天时会自动让路，中途发言不作废）。action=\"set\" 设置闹钟，time 支持分钟数（如 30）、HH:MM 或 YYYY-MM-DD HH:mm，repeat 支持 once（默认）/ daily / weekly（配 days 如 [1,3,5]，0=周日）/ interval（配 interval_min 或 time 填分钟数，可选 quiet_start 与 quiet_end 设置免打扰时段），label 为备注；action=\"list\" 查看全部闹钟；action=\"delete\" 传入 alarm_id 删除单个；action=\"clear\" 清空当前会话全部闹钟。",
    "inputSchema": {
        "type": "object",
        "properties": {
            "action": {"type": "string", "enum": ["set", "list", "delete", "clear"], "description": "set=定闹钟；list=看全部；delete=删单个；clear=全清"},
            "time": {"type": "string", "description": "set：分钟数（如 30）/ HH:MM（如 07:30）/ 日期时间（如 2026-10-26 07:30）"},
            "repeat": {"type": "string", "enum": ["once", "daily"], "description": "set：once 单次（默认）/ daily 每天循环"},
            "label": {"type": "string", "description": "set：备注，可写这个闹钟是干嘛的"},
            "alarm_id": {"type": "string", "description": "delete：要删的闹钟 id（从 list 拿）"}
        },
        "required": ["action"]
    },
    "handler": tool_wake
}
TOOLS["server_time"] = {
    "description": "获取当前服务器北京时间（返回年月日、星期与时分秒）。在需要确认当前时间、计算时长或安排定时唤醒前调用。",
    "inputSchema": {"type": "object", "properties": {}},
    "handler": tool_server_time
}

# ── 相册（2026-10-23）：她发的图/她上传的图都能进相册；你想留哪张就存，带一句批注；删只能删自己放的 ──
def _album_brief(it):
    # [位置:tools_server.py·_album_brief] [desc 空串不给] [10-28 第7项复核：desc 多数是空串，每张图白占一个字段] [注释时间 2026-10-28]
    # [批3精简（11-05）：source（哪来的图，AI 无决策价值）/has_chat（get 分支 chat 就在旁边）砍] [注释时间 2026-11-05]
    o = {"id": it.get("id"), "img_id": it.get("img_id"), "by": "你" if it.get("by") == "ai" else "她",
            "note": it.get("note") or "",
            "note_by": it.get("note_by") or "", "added_at": it.get("added_at")}
    if it.get("desc"):
        o["desc"] = it["desc"]
    return o

def tool_album(args):
    a = _act(args, "list", ("list", "get", "add", "note", "delete"), ("img", "note"))
    if a is None: return {"error": "action 只能是 list / get / add / note / delete"}
    base = BASE_URL + ":3000/internal/album/"
    if a == "list":
        try: count = max(1, min(100, int(args.get("limit") or args.get("count") or 30)))
        except Exception: count = 30
        try: offset = max(0, int(args.get("offset") or 0))
        except Exception: offset = 0
        d = api_get_key(base + "list?limit=%d&offset=%d" % (count, offset))
        if "_error" in d: return {"error": d["_error"]}
        # [位置:tools_server.py·album list] [批2：tip 恒定文案只在空相册时给] [2026-10-28]
        items = [_album_brief(x) for x in d.get("items") or []]
        out = {"total": d.get("total"), "items": items}
        if not items:
            out["tip"] = "相册是空的。add 存图：img 填上下文里 [图片 id:xxx] 的 xxx"
        return out
    if a == "get":
        k = str(args.get("id") or "").strip()
        if not k: return {"error": "id 必填：相册里的 id（list 返回）或图片 id（形如 img-xxxx-xxxx）"}
        d = api_get_key(base + "get?id=" + urllib.parse.quote(k))
        if "_error" in d: return {"error": "相册里没有这张（" + d["_error"][:60] + "）"}
        it = d.get("item") or {}
        out = _album_brief(it); out["url"] = it.get("url"); out["chat"] = it.get("ctx") or []
        # [位置:tools_server.py·album get·msg_id] [查看详情时带当时那条对话的 msg_id] [11-07：想回看存这张图时的对话，拿 msg_id 用 context 工具的 get（msg_id 唯一，session 不用带）；list 不带，省上下文] [注释时间 2026-11-07]
        out["msg_id"] = it.get("msg_id")
        return out
    if a == "add":
        img = str(args.get("img") or args.get("id") or "").strip()
        if not img: return {"error": "img 必填：上下文里图片前面的 [图片 id:xxx] 里的 xxx（形如 img-xxxx-xxxx）"}
        d = api_post_key(base + "add", {"img": img, "note": args.get("note") or "", "session_id": args.get("session_id") or ""})
        if "_error" in d: return {"error": "存图失败：" + d["_error"][:120]}
        # [位置:tools_server.py·album add 返回] [批3精简（11-05）：existed/item 回显砍，成功即可] [注释时间 2026-11-05]
        return {"ok": True}
    k = str(args.get("id") or "").strip()
    if not k: return {"error": "id 必填"}
    if a == "note":
        d = api_post_key(base + "note", {"id": k, "note": args.get("note") or ""})
    else:
        d = api_post_key(base + "delete", {"id": k})
    if "_error" in d: return {"error": ("操作失败：" + d["_error"][:160])}
    return {"ok": True}
TOOLS["album"] = {
    "description": "管理你们的共享相册（收录她在聊天中发送的带 [图片 id:xxx] 图片及手动上传的照片，仅允许删除你自己添加的记录）。action=\"list\"（默认）按页查看相册清单与批注（limit 默认 30，offset 翻页）；action=\"get\" 传入相册 id（al_ 开头）或图片 id（img- 开头）查看详情、地址与当时对话；action=\"add\" 传入 img 与可选 note 存图进相册；action=\"note\" 传入 id 与 note 编写或修改批注；action=\"delete\" 传入 id 删除相册记录（不影响聊天原图）。",
    "inputSchema": {
        "type": "object",
        "properties": {
            "action": {"type": "string", "enum": ["list", "get", "add", "note", "delete"], "description": "list=看相册（默认）；get=看某张详情和当时对话；add=存图；note=写批注；delete=删（只能删自己放的）"},
            "img": {"type": "string", "description": "add：图片 id，来自 [图片 id:xxx]，形如 img-xxxx-xxxx"},
            "id": {"type": "string", "description": "get / note / delete：相册 id（list 返回，al_ 开头）或图片 id"},
            "note": {"type": "string", "description": "add / note：批注，一句话"},
            "limit": {"type": "integer", "description": "list：条数，默认 30"},
            "offset": {"type": "integer", "description": "list：跳过前面多少张，默认 0"}
        }
    },
    "handler": tool_album
}

# ── 12. 今日总结（AI写）──

# ── 手机app使用记录（phone_records 工具）2026-09-26 删除：其数据已并入 phone_state
#    查岗工具的返回（app_records 字段，读 8080 /summary）；8084 phone-records-api 服务同步下线。──

# ── 12. 手机状态快照（2026-09-27 B 方案：手机打开「查岗」快捷指令自动上传，工具直读最新快照，不再发邮件触发）──
_PHONE_REPORT_TOKEN = os.environ.get("PHONE_STATE_TOKEN", "")  # 对应 phone-report-api(8080) systemd unit 的 AUTH_TOKEN，值在 .env
_OWNER = "han"  # 这是唯一的主人，即 han 本人的手机；没有"别的用户"


def _read_phone_state():
    """读 8080 phone-report-api 的最新快照。"""
    url = "http://localhost:8080/state/latest?user_id=" + urllib.parse.quote(_OWNER)
    req = urllib.request.Request(url, headers={"Authorization": "Bearer " + _PHONE_REPORT_TOKEN})
    with urllib.request.urlopen(req, timeout=5) as resp:
        return json.loads(resp.read()).get("state")


def tool_phone_state(args):
    def _flag(name, default=True):
        v = args.get(name, default)
        if isinstance(v, str):
            v = v.strip().lower() not in ("false", "0", "no", "off")
        return bool(v)

    weather = _flag("weather")
    location = _flag("location", False)  # 2026-10-16：位置默认不返回，需要时显式传 true
    try:
        n_app = int(args.get("app_records", 5))
    except (TypeError, ValueError):
        n_app = 5
    n_app = max(0, n_app)

    # B 方案（2026-09-27）：不再发邮件触发；手机打开「查岗」快捷指令时自动全量上报，
    # 这里直接读 8080 库里的最新快照即返回，快照新旧看 created_at
    try:
        state = _read_phone_state()
    except Exception as e:
        return {"error": "读取手机状态失败: " + str(e)}

    if not state:
        return {"error": "暂无手机上报数据（手机打开「查岗」快捷指令上传一次后即有快照）"}

    # 手机端永远全量上报；weather/location 两个开关在工具侧过滤返回内容
    result = {
        "battery": state.get("battery"),
        "created_at": state.get("created_at"),
    }
    if weather:
        result["weather"] = state.get("weather")
    if location:
        result["location"] = state.get("location")

    if n_app > 0:
        try:
            url = "http://localhost:8080/summary?user_id=" + urllib.parse.quote(_OWNER) + "&days=1"
            req = urllib.request.Request(url, headers={"Authorization": "Bearer " + _PHONE_REPORT_TOKEN})
            with urllib.request.urlopen(req, timeout=5) as resp:
                data = json.loads(resp.read())
            # [位置:tools_server.py·phone_state app_records] [改成读一次使用一条的开/关+时长] [2026-11-06：同一个 App 合并记录改成记录 App 开和关，一次使用一条；旧的「打开 App：X」当兜底] [注释时间 2026-11-06]
            sessions = [x for x in (data.get("sessions") or []) if isinstance(x, dict) and x.get("text")]
            if sessions:
                result["app_records"] = [x["text"] for x in sessions[:n_app]]
            else:
                # 改造前的老数据：还没有开/关段，退回旧的「打开 App：X」
                result["app_records"] = [r.get("content") for r in (data.get("records") or [])
                                         if isinstance(r, dict) and r.get("record_type") != "activity"][:n_app]
        except Exception as e:
            result["app_records"] = ["读取 App 记录失败: " + str(e)]

    return result

TOOLS["phone_state"] = {
    "description": "查看她手机最近一次上报的设备与活动状态，包括电量、天气、近期 App 使用记录（起止时间、时长与当前使用状态）及上报时间 created_at。仅在聊天确实需要关心她的状态或判断是否方便打扰时按需调用，不要每轮例行查询；位置信息默认不返回，确有需要时传 location=true。",
    "inputSchema": {
        "type": "object",
        "properties": {
            "weather": {"type": "boolean", "description": "是否要天气，默认 true"},
            "location": {"type": "boolean", "description": "是否要位置，默认 false，需要时传 true"},
            "app_records": {"type": "integer", "description": "附带最近App记录条数，默认 5，0=不带"}
        }
    },
    "handler": tool_phone_state
}


# ── 永久注入上下文（pin）：2026-09-23 已整体移除 ──
# 原 pin_add / pin_update / pin_delete 三个 MCP 工具，连同其专属辅助函数
# _pin_call / _find_pin_by_title 一并删除。三者的 TOOLS 注册早在 2026-09 初即被注释停用
# （未暴露给 AI），本次删除不改变任何运行时行为，仅为清理残留函数体。
# 替代路径：AI 侧新增 pin 走 <pin> 标签（gateway tag-parser.js → memoryEngine.addPinnedMemory）；
#          pin 的改/删由管理台 /heartbeat/admin/logs/pinned 承担。



# ── 上下文记忆替换 ──
def tool_context_by_time(args):
    # [位置:tools_server.py·tool_context_by_time] [按时间 / 最新定位原文，不经内容检索] [11-09：老三件（context_search/context_star/context_star_list）整个删掉不留兜底；
    # 原 context_search 里 time_prefix / latest 两种用法收拢到这里（context.search 带这两个参数时走它）。内容检索（q）走网关 /internal/search，不再经老接口，
    # 所以这里不再有 q / mode / 无 q 回退最新用户消息 / 精排标记。同时给了 q 与 time_prefix 时按时间定位、q 不参与，回执里说明] [注释时间 2026-11-09]
    time_prefix = (args.get("time_prefix") or "").strip()
    try:
        latest = max(0, min(100, int(args.get("latest") or 0)))   # 没传 = 0（原来写成 max(1, …)，没传 latest 也变成 1，time_prefix 单独用时被当成「最近 1 条」，11-09 测试发现）
    except (TypeError, ValueError):
        latest = 0
    try:
        limit = max(1, min(50, int(args.get("limit") or 8)))
    except (TypeError, ValueError):
        limit = 8
    # 默认 current：与 context.search 一致（10-27 审查）；latest 在未指定 session_id 时跨全部会话，传了 session_id 时按该会话过滤
    scope = args.get("scope", "current")
    target_sid = str(args.get("session_id") or "").strip()
    params = {"limit": str(limit), "all_sessions": "1" if (scope == "all" or target_sid) else "0"}
    if latest:
        params["all_sessions"] = "1"
        params["latest"] = str(max(latest, 100) if target_sid else latest)
    else:
        params["time_prefix"] = time_prefix   # 1002-08: 纯时间定位——按消息时间缀前缀直接返回该时间消息（含 msg_id）
    url = f"{BASE_URL}:3000/internal/context-search?" + urllib.parse.urlencode(params)
    req = urllib.request.Request(url, headers={"x-internal-key": INTERNAL_KEY})
    try:
        with urllib.request.urlopen(req, timeout=15) as resp:
            data = json.loads(resp.read().decode("utf-8"))
    except urllib.error.HTTPError as e:
        try:
            data = json.loads(e.read().decode("utf-8"))
        except Exception:
            data = {"error": f"HTTP {e.code}"}
    except Exception as e:
        return {"error": str(e)}
    if not data.get("ok"):
        return {"error": data.get("error", "检索失败")}
    # 同一段原文在「会话时间线」和「导入对话」两个来源各存一份，会各出一条；输出前按内容去重，每条只留 AI 要读的字段
    seen = set()
    matches = []
    for m in data.get("matches", []):
        if target_sid and scope != "all" and m.get("session") != target_sid:
            continue
        c = m.get("content") or ""
        if not c or c in seen:
            continue
        seen.add(c)
        matches.append({"session": m.get("session"), "msg_id": m.get("msg_id"), "content": c, "time": m.get("time"), "role": m.get("role")})
        if latest and len(matches) >= latest:
            break
    out = {"total": len(matches), "matches": matches}
    if (args.get("q") or "").strip() and not latest:
        out["note"] = "按 time_prefix 定位，q 没有参与；要按内容找请去掉 time_prefix 只传 q"
    return out


def tool_memory_search(args):
    q = (args.get("q") or "").strip()
    mid = str(args.get("id") or "").strip()   # 11-03：记忆关键词地图每行带 id，search 可只传 id 直接看那一条
    if not q and not mid:
        return {"error": "q 必填：检索记忆池的关键词或想问的问题（或只传 id 直接看某条记忆）"}
    limit = args.get("limit") or 5
    try:
        limit = max(1, int(limit))
    except (TypeError, ValueError):
        limit = 5
    category = (args.get("category") or "").strip()
    if category and category not in {"fact", "rule", "event"}:
        return {"error": "category 仅支持 fact、rule、event"}
    params = {"q": q, "limit": limit}
    if category:
        params["category"] = category
    if mid:
        params = {"id": mid}
    url = f"{BASE_URL}:3000/internal/memory-pool/retrieve?" + urllib.parse.urlencode(params)
    req = urllib.request.Request(url, headers={"x-internal-key": INTERNAL_KEY})
    try:
        with urllib.request.urlopen(req, timeout=10) as resp:
            data = json.loads(resp.read().decode("utf-8"))
    except urllib.error.HTTPError as e:
        try:
            data = json.loads(e.read().decode("utf-8"))
        except Exception:
            data = {"error": f"HTTP {e.code}"}
    except Exception as e:
        return {"error": str(e)}
    if data.get("ok"):
        # 1003-08 用户拍板：只透传 id+content（id 供 memory_pin/update；其余字段不再返回）；内容去重
        seen = set()
        items = []
        for it in data.get("items", []):
            c = it.get("content") or ""
            if not c or c in seen:
                continue
            seen.add(c)
            row = {"id": it.get("id"), "content": c}
            if mid:   # 按 id 直接看：多给分类/状态/时间，便于判断是否过期
                for k in ("kind", "status", "created_at"):
                    if it.get(k): row[k] = it.get(k)
            items.append(row)
        # [位置:tools_server.py·memory_search 返回] [批3精简（11-05）：total 恒等于 items 条数，砍] [注释时间 2026-11-05]
        return {"items": items}
    return {"error": data.get("error", "检索失败")}




def _parse_iso_ts(s):   # [11-09 原名 _star_parse_ts，标星工具下线后改名；_wake_at_local 在用]
    """ISO 时间字符串 -> 时间戳(UTC)；解析不了返回 None（排序时排最后）。

    注意：本机 /usr/bin/python3 是 3.6.8，没有 datetime.fromisoformat（3.7 才加入），
    首版用了它导致所有时间解析静默失败、排序退化成「保持原顺序」——看起来就是从旧到新。
    改为 strptime 手动解析 + 按 UTC 计算时间戳（naive datetime 减 epoch，不用 .timestamp()
    以免被本地时区二次偏移）。
    """
    if not isinstance(s, str) or not s.strip():
        return None
    t = s.strip()
    try:
        if t.endswith("Z"):
            t = t[:-1]
        # 分离小数秒
        frac = 0.0
        if "." in t:
            head, f = t.split(".", 1)
            digits = ""
            for ch in f:
                if ch.isdigit():
                    digits += ch
                else:
                    break
            if digits:
                frac = float("0." + digits)
            head = head + f[len(digits):]
        else:
            head = t
        # 时区偏移（+08:00 / -05:00）；无偏移按 UTC 处理
        offset = 0
        for sign in ("+", "-"):
            i = head.find(sign, 10)
            if i > 0:
                tzpart = head[i + 1:]
                head = head[:i]
                try:
                    parts = tzpart.split(":")
                    hh = int(parts[0] or "0")
                    mm = int(parts[1]) if len(parts) > 1 else 0
                    delta = hh * 3600 + mm * 60
                    offset = delta if sign == "+" else -delta
                except Exception:
                    offset = 0
                break
        dt = None
        for fmt in ("%Y-%m-%dT%H:%M:%S", "%Y-%m-%d %H:%M:%S"):
            try:
                dt = datetime.datetime.strptime(head, fmt)
                break
            except Exception:
                continue
        if dt is None:
            return None
        return (dt - datetime.datetime(1970, 1, 1)).total_seconds() + frac - offset
    except Exception:
        return None


# ===== 工具 context（2026-10-24 需求 29 合并；11-09 瘦身）=====
# 聊天原文的检索与查看：search / get 两个动作。
# 11-09 产品确定：老三件（context_search / context_star / context_star_list）整个删，不留兜底；context.star / list 动作下线（标星本条回复仍用 <star/> 标签，
# 那是网关 tag-parser 里的独立实现）。
# search 的内容检索走网关 GET /internal/search（同手机 /v1/search：语义+关键词五五开），默认只搜当前会话（session_id 由网关强制注入），scope=all 才跨所有会话；
# 片段由网关按「多关键词最优窗口」（lib/keyword-window.js）算好直接返回——算法只有网关那一份，这里不再有 Python 版；
# time_prefix / latest 不是内容检索，走 tool_context_by_time。
def tool_context_search_v2(args):
    if args.get("time_prefix") or args.get("latest"):
        return tool_context_by_time(args)
    q = (args.get("q") or "").strip()
    if not q:
        return {"error": "q 必填：要找的内容（关键词或一句描述，多个词用空格隔开）；按时间找请传 time_prefix，看最近的原文请传 latest"}
    try:
        limit = max(1, min(50, int(args.get("limit") or 8)))
    except (TypeError, ValueError):
        limit = 8
    scope = str(args.get("scope") or "current").strip().lower()
    params = {"q": q, "limit": str(limit), "with_id": "1", "snip": "1"}
    sid = str(args.get("session_id") or "").strip()
    if scope != "all":
        if not sid:
            return {"error": "拿不到当前会话，请传 scope=all 跨会话搜索"}
        params["sid"] = sid
    if sid:
        # [位置:tools_server.py·context search 排除最近 1 小时] [11-09：当前会话最近 1 小时的发言上下文里已有，不参与检索；scope=all 时也排当前会话那一小时（用 exclude_sid，不能复用 sid——sid 是「只搜这一个会话」）] [注释时间 2026-11-09]
        params["exclude_sid"] = sid
        params["exclude_recent_min"] = "60"
    url = "%s:3000/internal/search?%s" % (BASE_URL, urllib.parse.urlencode(params))
    req = urllib.request.Request(url, headers={"x-internal-key": INTERNAL_KEY})
    try:
        with urllib.request.urlopen(req, timeout=20) as resp:
            data = json.loads(resp.read().decode("utf-8"))
    except urllib.error.HTTPError as e:
        try: data = json.loads(e.read().decode("utf-8"))
        except Exception: data = {"error": "HTTP %s" % e.code}
    except Exception as e:
        return {"error": str(e)}
    if not data.get("ok"):
        return {"error": data.get("error", "检索失败")}
    import datetime as _dt
    tz = _dt.timezone(_dt.timedelta(hours=8))
    matches = []
    for r in data.get("results", []):
        ts = r.get("time") or 0
        try: t = _dt.datetime.fromtimestamp(ts / 1000.0, tz).strftime("%Y-%m-%d %H:%M") if ts else ""
        except Exception: t = ""
        m_ = {"msg_id": r.get("msg_id"), "role": r.get("role"), "time": t}
        if scope == "all": m_["session"] = r.get("sid")   # 11-03：会话 id 只在跨会话时才有用；搜当前会话时不返回，省上下文
        m_["snippet"] = str(r.get("snippet") or "")
        matches.append(m_)
    out = {"matches": matches}
    try: n_ex = int(data.get("excluded_recent") or 0)
    except (TypeError, ValueError): n_ex = 0
    if n_ex:
        out["note"] = "已排除当前会话最近 1 小时的 %d 条（上下文里已有）" % n_ex
    return out

def tool_context_get(args):
    # [位置:tools_server.py·tool_context_get] [按 msg_id 取原文全文，可带前后文窗口] [11-03：msg_id 直取全文；11-07：自动带前后各 window 条连续消息，邻居截 500 字、命中条 6000 截断；
    # 11-09 改：①取消 session 参数——AI 手里没有会话 id（搜当前会话时不返回），默认全库定位（网关口径：排除归档/子会话/不参与检索组），同 id 在多个会话有副本（分支/继承，全库约 1.8%）时全部返回、按会话分组，
    # 不再报 ambiguous 让 AI 补 session；全库没找到的 id 再到当前会话（网关注入的 session_id）兜底找一次（当前会话可能自己就在被排除的组里）；
    # ②window 允许 0：只要这一条、不带上下文（原来 0 被当成没填，悄悄变成 6）；③删 full_ids：search 只回片段，要全文统一用 get] [注释时间 2026-11-09]
    ids = args.get("ids")
    if isinstance(ids, str):
        ids = [x.strip() for x in ids.split(",") if x.strip()]
    if not isinstance(ids, list) or not ids:
        return {"error": 'ids 必填：msg_id 数组（search 返回的），例如 ["xxxx"]'}
    ids = [str(x) for x in ids][:20]
    window = 6
    if args.get("window") not in (None, ""):
        try: window = max(0, min(30, int(args.get("window"))))
        except (TypeError, ValueError): window = 6
    cur = str(args.get("session_id") or "").strip()

    def _fetch(sid_, ids_):
        params = {"ids": ",".join(ids_), "ctx": str(window)}
        if sid_:
            params["sid"] = sid_
        url = "%s:3000/internal/messages?%s" % (BASE_URL, urllib.parse.urlencode(params))
        req = urllib.request.Request(url, headers={"x-internal-key": INTERNAL_KEY})
        try:
            with urllib.request.urlopen(req, timeout=20) as resp:
                return json.loads(resp.read().decode("utf-8"))
        except urllib.error.HTTPError as e:
            try: return json.loads(e.read().decode("utf-8"))
            except Exception: return {"ok": False, "error": "HTTP %s" % e.code}
        except Exception as e:
            return {"ok": False, "error": str(e)}

    def _clip(msgs):
        # 邻居条（hit=false）只留前 500 字：窗口是给上下文的，全文只在命中条给；window=0 时没有 hit 字段，都是命中条
        for m in msgs:
            m.pop("session", None)
            t = str(m.pop("text", "") or "")
            cap = 500 if m.get("hit") is False else 6000
            if len(t) > cap: t = t[:cap] + ("…（邻居截断）" if cap == 500 else "…（后文截断）")
            m["content"] = t
        return msgs

    groups = []      # [{session, messages}]
    err = ""
    data = _fetch("", ids)
    if data.get("ok"):
        msgs = data.get("messages", [])
        if msgs:
            groups.append({"session": msgs[0].get("session") or "", "messages": _clip(msgs)})
        missing = data.get("missing", [])
    elif data.get("multi_session"):
        missing = data.get("missing", [])
        for g in data["multi_session"]:
            d2 = _fetch(g.get("session"), g.get("msg_ids") or [])
            if not d2.get("ok"):
                groups.append({"session": g.get("session"), "messages": [], "error": d2.get("error", "取原文失败")})
                continue
            groups.append({"session": g.get("session"), "messages": _clip(d2.get("messages", []))})
    else:
        err = data.get("error", "取原文失败")
        missing = list(ids)
    if missing and cur:
        d3 = _fetch(cur, missing)
        if d3.get("ok"):
            if d3.get("messages"):
                groups.append({"session": cur, "messages": _clip(d3["messages"])})
            missing = d3.get("missing", [])
            err = ""
    if not groups:
        if err:
            return {"error": err}
        return {"messages": [], "missing": missing, "note": "这些 msg_id 没找到（可能在已归档会话、不参与检索的会话里，或 id 不对）"}
    out = {}
    if len(groups) == 1:
        out["messages"] = groups[0]["messages"]
    else:
        out["groups"] = groups
        out["note"] = "同一条在多个会话里有副本（会话分支/继承造成），或这几条分布在不同会话，已按会话分组全部返回"
    if missing:
        out["missing"] = missing
    return out

def tool_context(args):
    a = _act(args, "search", ("search", "get"), ("msg_ids", "marked"))
    if a == "get": return tool_context_get(args)
    if a == "search": return tool_context_search_v2(args)
    return {"error": "action 只能是 search 或 get（标星别条原文的功能已下线；标星本条回复用 <star/> 标签）"}

TOOLS["context"] = {
    "description": "检索与回看历史聊天原文（包含已被状态机或压缩替换的对话）。action=\"search\"（默认）按关键词搜索，q 支持空格分隔多词，可传 session_id 指定目标会话，scope 可选 current（当前/指定会话，默认）或 all（全部会话），limit 默认 8 最大 50；支持 time_prefix（如 2026-08-28）按日期筛选，或 latest=N（1-100）直接拉取最新原文（传 session_id 时只看该会话）。action=\"get\" 传入 ids（msg_id 数组，最多 20 条）读取原文，默认附带前后各 6 条对话，可用 window（0-30）调节窗口大小。",
    "inputSchema": {
        "type": "object",
        "properties": {
            "action": {"type": "string", "enum": ["search", "get"], "description": "search=检索（默认）；get=按 msg_id 取全文"},
            "session_id": {"type": "string", "description": "search 可选：指定要查的目标小手机会话 ID（跨客户端查指定会话时传入）"},
            "q": {"type": "string", "description": "search：关键词或描述，多个词用空格隔开"},
            "scope": {"type": "string", "enum": ["current", "all"], "description": "search：current=只搜当前/指定会话（默认）；all=跨所有会话"},
            "limit": {"type": "integer", "description": "search：返回条数，默认 8，最多 50"},
            "time_prefix": {"type": "string", "description": "search：消息时间前缀（如 2026-08-28 或 2026-08-28T19:34），按时间定位原文"},
            "latest": {"type": "integer", "description": "search：填 N（1-100），直接返回最近 N 条原文，忽略 q（传 session_id 时仅限该会话）"},
            "ids": {"type": "array", "items": {"type": "string"}, "description": "get：要看全文的消息 msg_id（search 返回的），最多 20 条"},
            "window": {"type": "integer", "description": "get：前后各带几条对话（默认 6，1-30）；0=只要这一条、不带上下文"}
        }
    },
    "handler": tool_context
}


def tool_memory_update(args):
    mid = (args.get("id") or "").strip()
    content = (args.get("content") or "").strip()
    if not mid:
        return {"error": "id 必填：记忆 id（memory_search 返回的 id 字段）"}
    if not content:
        return {"error": "content 必填：覆盖后的记忆正文"}
    url = f"{BASE_URL}:3000/internal/memory-v2/update"
    req = urllib.request.Request(url,
        data=json.dumps({"id": mid, "content": content}).encode("utf-8"),
        headers={"Content-Type": "application/json", "x-internal-key": INTERNAL_KEY},
        method="POST")
    try:
        with urllib.request.urlopen(req, timeout=10) as resp:
            out = json.loads(resp.read().decode("utf-8"))
    except urllib.error.HTTPError as e:
        try:
            out = json.loads(e.read().decode("utf-8"))
        except Exception:
            out = {"error": f"HTTP {e.code}"}
    except Exception as e:
        return {"error": str(e)}
    if out.get("success"):
        entry = out.get("entry") or {}
        if out.get("unchanged"):
            return {"ok": True, "message": "新正文与原记忆相同，未提交"}
        # [位置:tools_server.py·memory_update 返回] [批3精简（11-05）：id 回显砍；文案口径「待她批准」→「待审核」] [注释时间 2026-11-05]
        return {"ok": True, "message": "已提交改写，待审核（审核前原记忆不变）"}
    return {"error": out.get("error", "更新失败")}


def _norm_triggers(v):
    # 11-04：AI 存记忆时顺手写的关键词（逗号/顿号分隔的字符串或数组），最多 3 个，每个 ≤ 20 字
    if isinstance(v, str):
        import re as _re
        v = _re.split(r"[,，、;；\n]+", v)
    out = []
    for x in (v or []):
        x = str(x).strip()
        if x and x not in out:
            out.append(x[:20])
    return out[:3]


def tool_memory_add(args):
    content = (args.get("content") or "").strip()
    if not content:
        return {"error": "content 必填：要提交的记忆正文"}
    kind = (args.get("kind") or "").strip() or None
    if kind is not None and kind not in ("fact", "rule", "event"):
        return {"error": "kind 只能是 fact / rule / event（或省略）"}
    data = {"content": content}
    if kind:
        data["kind"] = kind
    vibe = (args.get("vibe") or "").strip()
    if vibe:
        data["vibe"] = vibe[:60]
    trg = _norm_triggers(args.get("triggers"))
    if trg:
        data["triggers"] = trg
    # 1010-17：服务端（mcp-tool-loop）会注入 session_id=当前会话，透传给 gateway 写 source_session 溯源
    if args.get("session_id"):
        data["session_id"] = str(args["session_id"]).strip()
    url = f"{BASE_URL}:3000/internal/memory-pool/add"
    req = urllib.request.Request(url,
        data=json.dumps(data).encode("utf-8"),
        headers={"Content-Type": "application/json", "x-internal-key": INTERNAL_KEY},
        method="POST")
    try:
        # [位置:tools_server.py·memory_add 超时] [2026-10-27 审查：原来 100s > 网关 callTimeoutMs 60s，门卫打分慢时
        # 客户端 60s 就报超时重试、后台 judge 还在跑，同一记忆提交两次。压到 55s（<60s）：真慢时 AI 拿到明确报错，
        # judge 在网关侧照常跑完入池；重试前网关 judge 幂等仍以内容去重兜底。原 10s 的问题（掐断 judge）在 1010-17 已知] [注释时间 2026-10-27]
        with urllib.request.urlopen(req, timeout=55) as resp:
            out = json.loads(resp.read().decode("utf-8"))
    except urllib.error.HTTPError as e:
        try:
            out = json.loads(e.read().decode("utf-8"))
        except Exception:
            out = {"error": f"HTTP {e.code}"}
    except Exception as e:
        return {"error": str(e)}
    if out.get("success"):
        # [位置:tools_server.py·memory_add 返回] [批2：action/queue_id 内部码砍，note 可能带门卫提示故保留] [2026-10-28]
        # [位置:tools_server.py·memory_add 返回] [批3精简（11-05）：success 砍；note（网关回「已进入人工待审队列…」）保留] [注释时间 2026-11-05]
        return {"ok": True, "note": out.get("note") or "已提交记忆"}
    return {"error": out.get("error", "提交失败")}






# ===== 工具集 v2 合并工具（2026-10-16）=====
# memory / notebook / todo 各合成一个带 action 的工具，内部复用上面的原 handler。
# 2026-10-22：旧工具（memory_add 等 8 个）的注册已删除（现役 memory/notebook/todo；原 handler 函数留作合并工具内部复用），LEGACY 兜底随之下线。


def _pick_action(args, allowed):
    action = str(args.get("action") or "").strip().lower()
    if action not in allowed:
        return None, {"error": "action 只能是 " + " / ".join(allowed)}
    return action, None


def tool_memory_sink(args):
    mid = str(args.get("id") or "").strip()
    if not mid:
        return {"error": "id 必填：记忆 id（action=search 返回的 id 字段）"}
    sunk = args.get("sunk")
    if sunk is None:
        sunk = True
    elif isinstance(sunk, str):
        sunk = sunk.strip().lower() not in ("false", "0", "no", "off")
    # 只传 sunk、不传 pinned：网关据此只改沉底状态，不动置顶（置顶工具 memory_pin 保持停用）
    data = {"id": mid, "sunk": bool(sunk)}
    url = f"{BASE_URL}:3000/internal/memory-pool/pin"
    req = urllib.request.Request(url,
        data=json.dumps(data).encode("utf-8"),
        headers={"Content-Type": "application/json", "x-internal-key": INTERNAL_KEY},
        method="POST")
    try:
        with urllib.request.urlopen(req, timeout=10) as resp:
            out = json.loads(resp.read().decode("utf-8"))
    except urllib.error.HTTPError as e:
        try:
            out = json.loads(e.read().decode("utf-8"))
        except Exception:
            out = {"error": f"HTTP {e.code}"}
    except Exception as e:
        return {"error": str(e)}
    if out.get("success"):
        # [位置:tools_server.py·memory_sink 返回] [批3精简（11-05）：id/sunk 回显、content 片段 AI 已知，成功即可] [注释时间 2026-11-05]
        return {"ok": True}
    return {"error": out.get("error", "操作失败")}


def tool_memory(args):
    action, err = _pick_action(args, ("add", "search", "update", "sink"))
    if err:
        return err
    if action == "add":
        return tool_memory_add(args)
    if action == "search":
        a = dict(args)
        if a.get("kind") and not a.get("category"):
            a["category"] = a["kind"]
        return tool_memory_search(a)
    if action == "update":
        return tool_memory_update(args)
    return tool_memory_sink(args)


TOOLS["memory"] = {
    "description": "管理长期记忆池。action=\"add\" 提交新记忆，content 必填（须基于真实对话且具备长期价值，禁止编造），kind 可选 fact（稳定事实）/ rule（规则承诺）/ event（具体事件），event 可附带 vibe（简短氛围）与 triggers（最多 3 个召回词），提交后经门卫评分进入待审队列；action=\"search\" 按 q（关键词或描述）检索记忆，支持 kind 筛选与 limit（默认 5），已知记忆 id 时可直接传 id 查看单条；action=\"update\" 传入 id 与完整新正文 content 提交改写审核；action=\"sink\" 传入 id 将过时记忆沉底（sunk 默认 true，传 false 恢复）。使用规范：add 前先 search，内容相近优先 update，过时直接 sink。",
    "inputSchema": {
        "type": "object",
        "properties": {
            "action": {"type": "string", "enum": ["add", "search", "update", "sink"], "description": "要执行的操作：add / search / update / sink"},
            "content": {"type": "string", "description": "add：记忆正文（基于真实对话，不编造）；update：覆盖后的完整正文"},
            "kind": {"type": "string", "enum": ["fact", "rule", "event"], "description": "fact=稳定事实 / rule=规则、边界、承诺 / event=具体事件；add 可省略，search 作分类筛选"},
            "vibe": {"type": "string", "description": "add 时可选（仅 event）：这条记忆的气味、氛围或情感，一两句内（60 字内）；想写就写，不写就留空"},
            "triggers": {"type": "string", "description": "add 时可选（仅 event，fact/rule 不要写）：这条记忆的召回关键词，最多 3 个，逗号分隔；她以后说到这些词时记忆会被找回。想写就写，不写就留空"},
            "q": {"type": "string", "description": "search：检索关键词、问题或描述（只传 id 直接看某条时可省略）"},
            "limit": {"type": "integer", "description": "search 返回条数，默认 5"},
            "id": {"type": "string", "description": "update / sink 必填：记忆 id（search 返回的 id 字段）；search 时只传 id = 直接看这一条"},
            "sunk": {"type": "boolean", "description": "sink 时可选：true=沉底（默认），false=从沉底恢复"}
        },
        "required": ["action"]
    },
    "handler": tool_memory
}


def _slim_note(d):
    # 11-04 工具精简第二轮：笔记条目里的空串 / pinned:false / created_at（updated_at 已带）对 AI 没有信息量，不再返回
    if not isinstance(d, dict): return d
    out = {}
    for k, v in d.items():
        if k == "created_at" or v == "" or v is None or (k == "pinned" and v is False): continue
        out[k] = v
    return out

def _slim_note_list(data):
    # [位置:tools_server.py·_slim_note_list] [批3精简（11-05）：returned 与 items 长度重复砍；total 只在总数和这次返回条数不一样时才给] [注释时间 2026-11-05]
    if isinstance(data, dict):
        for key in ("recent", "items"):
            if isinstance(data.get(key), list):
                data[key] = [_slim_note(x) for x in data[key]]
        items = data.get("items")
        if isinstance(items, list):
            data.pop("returned", None)
            if data.get("total") == len(items):
                data.pop("total", None)
    return data

def tool_notebook_list_v2(args):
    sid = str(args.get("session_id") or "").strip()
    pid = args.get("id")
    if pid not in (None, ""):
        try:
            pid = int(pid)
        except (TypeError, ValueError):
            return {"error": "id 需为列表返回的编号数字"}
        vqs = {"id": pid}
        if sid:
            vqs["session_id"] = sid
        full = api_get_key("%s:3000/internal/paper/view?%s" % (BASE_URL, urllib.parse.urlencode(vqs)))
        if "_error" in full:
            return {"error": full["_error"]}
        # [位置:tools_server.py·notebook_list 全文分支返回] [批3精简（11-05）：id 是入参回显、created_at 冗余（updated_at 已带），砍] [注释时间 2026-11-05]
        return {"title": full.get("title") or "", "summary": full.get("summary") or "无",
                "reason": full.get("reason") or "无", "folder": full.get("folder") or "（根目录）",
                "updated_at": full.get("updated_at") or full.get("created_at") or full.get("time"),
                "content": full.get("content")}
    q = str(args.get("q") or "").strip()
    has_paging = args.get("limit") not in (None, "") or args.get("offset") not in (None, "")
    if not q and not has_paging:
        ov_url = "%s:3000/internal/paper/overview" % BASE_URL
        if sid:
            ov_url += "?" + urllib.parse.urlencode({"session_id": sid})
        data = api_get_key(ov_url)
        if "_error" in data:
            return {"error": data["_error"]}
        return _slim_note_list(data)   # 批2：恒定使用提示 message 砍（用法在工具描述里，不必每次复读）
    params = {}
    if sid:
        params["session_id"] = sid
    if q:
        params["q"] = q
    folder = str(args.get("folder") or "").strip()   # 10-29：只看某文件夹直属的笔记（fid 或完整路径）
    if folder:
        params["folder"] = folder
    for k in ("limit", "offset"):
        if args.get(k) not in (None, ""):
            params[k] = args.get(k)
    data = api_get_key("%s:3000/internal/paper/query?%s" % (BASE_URL, urllib.parse.urlencode(params)))
    if "_error" in data:
        return {"error": data["_error"]}
    data.pop("offset", None)   # 批2：请求回显砍
    data.pop("limit", None)
    return _slim_note_list(data)


def tool_notebook_edit(args):
    sid = str(args.get("session_id") or "").strip()
    folder = str(args.get("folder") or "").strip()
    if folder:
        # 10-29：改文件夹摘要（folder 认 fid 或完整路径；summary 必填）
        summary = str(args.get("summary") or "").strip()
        if not summary:
            return {"error": "改文件夹摘要：folder（fid 或完整路径）+ summary（要改成的一句话）都必填"}
        data = api_post_key("%s:3000/internal/paper/folder/edit" % BASE_URL, {"folder": folder, "summary": summary, "session_id": sid})
        if "_error" in data:
            return {"error": "文件夹摘要修改失败: %s" % data["_error"]}
        if not data.get("success"):
            return {"error": "文件夹摘要修改失败: %s" % data}
        # [位置:tools_server.py·notebook_edit 文件夹摘要返回] [批3精简（11-05）：folder/summary 都是回显、message 恒定，成功即可] [注释时间 2026-11-05]
        return {"ok": True}
    try:
        pid = int(args.get("id"))
    except (TypeError, ValueError):
        return {"error": "id 必填：要修改的那一篇的编号（action=list 返回的 id）；改文件夹摘要则传 folder+summary"}
    # ---- 置顶/取消置顶（2026-11-02：AI 工具可编辑置顶字段；可与 content/title/... 同一次调用）----
    pin_result = None
    if args.get("pinned") is not None:
        pin_data = api_post_key("%s:3000/internal/paper/pin" % BASE_URL, {"id": pid, "pinned": bool(args.get("pinned")), "session_id": sid})
        if "_error" in pin_data:
            return {"error": "置顶失败: %s" % pin_data["_error"]}
        if not pin_data.get("success"):
            return {"error": "置顶失败: %s" % pin_data}
        pin_result = {"pinned": bool(pin_data.get("pinned")),
                      "message": ("已置顶" if pin_data.get("pinned") else "已取消置顶") + "：" + str(pin_data.get("title") or "（无标题）") +
                                 "；上下文里的 Pinned Notes 块要等快照重建才更新"}
    has_old = args.get("old") is not None
    raw_mode = args.get("mode")
    mode = str(raw_mode if raw_mode not in (None, "") else ("patch" if has_old else "append")).strip().lower()
    if mode not in ("append", "replace", "patch"):
        return {"error": "mode 只能是 append、replace 或 patch"}
    payload = {"id": pid, "mode": mode, "session_id": sid}
    for k in ("content", "old", "new", "title", "summary", "reason"):
        if args.get(k) is not None:
            payload[k] = str(args.get(k))
    if args.get("replace_all") is not None:
        payload["replace_all"] = bool(args.get("replace_all"))
    if not any(k in payload for k in ("content", "old", "title", "summary", "reason")):
        if pin_result:
            # [位置:tools_server.py·notebook_edit 纯置顶返回] [批3精简（11-05 拍板：置顶也只留 title+时间）；pinPaper 不回 updated_at，故只有 title；pinned/message 是回显或恒定文案] [注释时间 2026-11-05]
            return {"title": str(pin_data.get("title") or "（无标题）")}
        return {"error": "没有要改的内容：content / old+new / title / summary / reason / pinned 至少给一个"}
    data = api_post_key("%s:3000/internal/paper/edit" % BASE_URL, payload)
    if "_error" in data:
        return {"error": "AI 的笔记本修改失败: %s" % data["_error"]}
    if not data.get("success"):
        return {"error": "AI 的笔记本修改失败: %s" % data}
    # [位置:tools_server.py·notebook_edit 返回] [批3精简（11-05 拍板）：只留 title+updated_at，其余是入参回显或恒定文案；
    # 与置顶同一次调用时置顶已生效（/internal/paper/pin 已先调），返回同口径；旧版后台留存的说明在工具描述里] [注释时间 2026-11-05]
    ids = data.get("ids") or ([data.get("id")] if data.get("id") is not None else [])
    if len(ids) > 1:
        # [位置:tools_server.py·notebook_edit 返回] [追加超限重拆要告诉 AI 续篇 id] [11-16] [注释时间 2026-11-16]
        return {"title": data.get("title"), "updated_at": data.get("updated_at"), "ids": ids, "parts": len(ids)}
    return {"title": data.get("title"), "updated_at": data.get("updated_at")}


def tool_notebook_delete(args):
    # 2026-10-24 需求 54：删一篇笔记；网关删之前整份备份 papers.json + papers-history.json，整篇另进 papers-history（reason=delete）
    sid = str(args.get("session_id") or "").strip()
    try: pid = int(args.get("id"))
    except (TypeError, ValueError): pid = 0
    if pid < 1:
        return {"error": "id 必填：要删的那一篇的 id（用 action=list 查看）"}
    data = api_post_key("%s:3000/internal/paper/delete" % BASE_URL, {"id": pid, "session_id": sid})
    if "_error" in data:
        return {"error": "删除失败: %s" % data["_error"]}
    if not data.get("success"):
        return {"error": "删除失败: %s" % data}
    # [位置:tools_server.py·notebook_delete 返回] [批3精简（11-05）：id 是回显；title 是被删的标题（确认删对了）；删前自动备份的说明在工具描述里] [注释时间 2026-11-05]
    return {"ok": True, "title": str(data.get("title") or "（无标题）")}

def tool_notebook_folder_add(args):
    # 10-29：新建文件夹；完整路径逐级自动建（"故事/第一卷" 一条建两层），已存在的层跳过
    sid = str(args.get("session_id") or "").strip()
    path = str(args.get("path") or "").strip()
    if not path:
        return {"error": "path 必填：文件夹完整路径（可含 / 逐级建，一段 1-30 字，最多 5 层）"}
    data = api_post_key("%s:3000/internal/paper/folder/add" % BASE_URL, {"path": path, "session_id": sid})
    if "_error" in data:
        return {"error": "新建文件夹失败: %s" % data["_error"]}
    if not data.get("success"):
        return {"error": "新建文件夹失败: %s" % data}
    # [位置:tools_server.py·notebook_folder_add 返回] [批3精简（11-05）：path 是回显，成功即可] [注释时间 2026-11-05]
    return {"ok": True}


def tool_notebook(args):
    action, err = _pick_action(args, ("add", "list", "edit", "delete", "folder_add"))
    if err:
        return err
    if action == "add":
        return tool_notebook_add(args)
    if action == "list":
        return tool_notebook_list_v2(args)
    if action == "delete":
        return tool_notebook_delete(args)
    if action == "folder_add":
        return tool_notebook_folder_add(args)
    return tool_notebook_edit(args)


TOOLS["notebook"] = {
    "description": "管理个人笔记本，用来安放沉淀下来的长期记忆与随手整理的内容。\n\n展示与使用方式：\n笔记本目录与每篇笔记的摘要会一直呈现在上下文中，方便随时知道自己记过什么。\n置顶笔记的正文会直接进入上下文，适合存放从日常与状态机里沉淀出来、长期稳定且需要反复参考的内容。\n未置顶的笔记可以随心分文件夹自由记录，想写什么都可以，需要时再通过本工具读取全文。如果是用来记一件事的记忆笔记，可以把精简提炼后的核心写在摘要里、把详细过程留在正文里，兼顾轻便与完整。\n\n操作方式：\naction=\"add\" 新建笔记，填写 title 与 content，folder 可按需分类（不存在会自动创建），summary 可填写精简摘要；\naction=\"list\" 查看目录或检索，无参返回最近 10 篇与文件夹清单，传 id 读全文，q 按关键词检索，folder 按文件夹筛选，支持 limit 与 offset 翻页；\naction=\"edit\" 按 id 修改，支持 old+new 局部替换、content 追加或更新，也可单独调整 title、summary、pinned（true 为置顶）或文件夹摘要；\naction=\"delete\" 按 id 删除（删前自动备份）；\naction=\"folder_add\" 按 path 逐级新建文件夹。",
    "inputSchema": {
        "type": "object",
        "properties": {
            "action": {"type": "string", "enum": ["add", "list", "edit", "delete", "folder_add"], "description": "要执行的操作：add / list / edit / delete / folder_add"},
            "content": {"type": "string", "description": "add：正文（建议单篇一两千字以内）；edit：要追加或覆盖的内容"},
            "title": {"type": "string", "description": "add / edit：标题（可选）"},
            "summary": {"type": "string", "description": "add / edit：一句话摘要（概括这篇写了什么，出现在目录里；建议每篇都写）"},
            "reason": {"type": "string", "description": "add / edit：可选，一句话写为什么记这个"},
            "id": {"type": "integer", "description": "list：传入则返回该篇全文；edit / delete：必填，要修改或删除的那一篇（用列表里返回的 id）"},
            "q": {"type": "string", "description": "list：关键词搜索，匹配标题、摘要、原因和正文，多个词用空格分隔（需同时命中），返回命中片段"},
            "limit": {"type": "integer", "description": "list：返回条数，默认 10，最多 50"},
            "offset": {"type": "integer", "description": "list：翻页偏移，默认 0"},
            "mode": {"type": "string", "enum": ["append", "replace", "patch"], "description": "edit：append=追加到末尾（默认）；replace=整篇覆盖（覆盖前后台自动留存上一版）；patch=精确局部替换（传 old+new 时自动走 patch）。只改标题/摘要/原因时不用传 content"},
            "old": {"type": "string", "description": "edit 局部替换：要替换的原正文片段（须与原文一字不差且唯一命中，多处命中可配 replace_all=true）"},
            "new": {"type": "string", "description": "edit 局部替换：替换后的新文本（传空串即删除 old 片段）"},
            "replace_all": {"type": "boolean", "description": "edit 局部替换：为 true 时替换正文里所有匹配的 old 片段，默认 false（仅允许唯一命中）"},
            "folder": {"type": "string", "description": "add：放进哪个文件夹（完整路径如 游戏记录，不存在自动建）；list：只看该文件夹直属的笔记（fid 如 f2 或完整路径）；edit：改文件夹摘要时必填（fid 或完整路径）"},
            "path": {"type": "string", "description": "folder_add 必填：文件夹完整路径，可含 / 逐级建（如 故事/第一卷），一段 1-30 字、最多 5 层"},
            "pinned": {"type": "boolean", "description": "edit：可选，true=置顶 / false=取消置顶；置顶的笔记全文进上下文 Pinned Notes 块（快照重建时更新）"}
        },
        "required": ["action"]
    },
    "handler": tool_notebook
}


def tool_todo_delete(args):
    try:
        tid = int(args.get("id"))
    except (TypeError, ValueError):
        return {"error": "id 必填：待办 id（action=list 返回的 id）"}
    data = api_get(f"{BASE_URL}:8777/todo/api/todos")
    if isinstance(data, dict) and "_error" in data:
        return {"error": data["_error"]}
    items = data if isinstance(data, list) else []
    target = next((t for t in items if t.get("id") == tid), None)
    if target is None:
        return {"error": "找不到未完成的待办：id=%d（先 action=list 看最新清单）" % tid}
    res = api_post(f"{BASE_URL}:8777/todo/api/todos/delete", {"id": tid})
    if "_error" in res:
        return {"error": "删除失败: %s" % res["_error"]}
    return {"ok": True}   # [批3精简（11-05）：id/text 是回显砍，成功即可（10-28 批2 还带 text）] [2026-11-05]


def tool_todo(args):
    action, err = _pick_action(args, ("add", "list", "delete"))
    if err:
        return err
    if action == "add":
        return tool_todo_add(args)
    if action == "list":
        return tool_todo_list(args)
    return tool_todo_delete(args)


TOOLS["todo"] = {
    "description": "管理她的待办清单。action=\"add\" 新增待办，text 必填，remind_at 可选（YYYY-MM-DD HH:mm，须为未来时间，到点自动推送提醒）；action=\"list\" 查看全部未完成待办及对应 id；action=\"delete\" 传入 id 删除待办，仅在她明确要求、已办完或取消时调用。",
    "inputSchema": {
        "type": "object",
        "properties": {
            "action": {"type": "string", "enum": ["add", "list", "delete"], "description": "要执行的操作：add / list / delete"},
            "text": {"type": "string", "description": "add 必填：待办内容"},
            "remind_at": {"type": "string", "description": "add 可选：提醒时间，格式 YYYY-MM-DD HH:mm，按项目 TIME_ZONE 时区；必须是未来时间"},
            "id": {"type": "integer", "description": "delete 必填：待办 id（action=list 返回）"}
        },
        "required": ["action"]
    },
    "handler": tool_todo
}


# ===== 小世界：AI 的沙盒目录（只能读写 little-world/apps/world/ 下的文本文件，不能执行命令）=====
# 1018 用户拍板：替代聊天侧「云服务器」MCP（root run_command/write_file）。
# 边界：路径必须落在 WORLD_ROOT 内（realpath 校验，拒绝 .. / 绝对路径 / 隐藏段 / 符号链接），
# 只认白名单扩展名的文本文件；单文件、总量、文件数都有上限。页面经 nginx /world/ 以 CSP sandbox 直出。
def _project_root():
    env = os.environ.get("PROJECT_ROOT", "").strip()
    if env:
        return env
    here = os.path.abspath(os.path.dirname(__file__))
    cur = here
    while True:
        if os.path.exists(os.path.join(cur, "package.json")):
            return cur
        parent = os.path.dirname(cur)
        if parent == cur:
            raise RuntimeError("PROJECT_ROOT not found")
        cur = parent
_ROOT = _project_root()
WORLD_ROOT = os.environ.get("WORLD_ROOT", "").strip() or os.path.join(_ROOT, "little-world", "apps", "world")
WORLD_URL = os.environ.get("WORLD_URL", "").rstrip("/")
WORLD_EXTS = (".html", ".htm", ".css", ".js", ".json", ".md", ".txt", ".svg", ".csv", ".xml")
WORLD_MAX_FILE = 512 * 1024
WORLD_MAX_TOTAL = 20 * 1024 * 1024
WORLD_MAX_FILES = 500
WORLD_READ_MAX = 60000
_world_lock = threading.Lock()


def _world_path(rel, want_file=True):
    rel = str(rel or "").strip().replace("\\", "/").lstrip("/")
    if not rel:
        if want_file:
            return None, {"error": "path 必填：小世界里的相对路径，如 index.html 或 notes/a.md"}
        return os.path.realpath(WORLD_ROOT), None
    parts = [p for p in rel.split("/") if p not in ("", ".")]
    for p in parts:
        if p == ".." or p.startswith("."):
            return None, {"error": "path 不能含 .. 或以 . 开头的段：" + rel}
    full = os.path.join(WORLD_ROOT, *parts)
    root = os.path.realpath(WORLD_ROOT)
    real = os.path.realpath(full)
    if real != root and not real.startswith(root + os.sep):
        return None, {"error": "path 越出小世界：" + rel}
    if os.path.islink(full):
        return None, {"error": "不支持符号链接：" + rel}
    if want_file and not real.lower().endswith(WORLD_EXTS):
        return None, {"error": "只支持这些文本文件：" + " ".join(WORLD_EXTS)}
    return real, None


def _world_rel(real):
    return os.path.relpath(real, os.path.realpath(WORLD_ROOT)).replace(os.sep, "/")


def _world_usage():
    total, count = 0, 0
    for dp, dns, fns in os.walk(WORLD_ROOT):
        dns[:] = [d for d in dns if not d.startswith(".")]
        for fn in fns:
            try:
                total += os.path.getsize(os.path.join(dp, fn))
                count += 1
            except OSError:
                pass
    return total, count


def tool_world_list(args):
    base, err = _world_path(args.get("path"), want_file=False)
    if err:
        return err
    if not os.path.isdir(base):
        return {"error": "目录不存在：" + str(args.get("path") or "")}
    # [位置:tools_server.py·tool_world_list] [统计并入同一遍 walk] [2026-10-27 审查 P2：原来文件清单走一遍
    # os.walk、配额统计（_world_usage）再全量走一遍，小世界文件多了双倍 IO；根目录 list 时并成一遍。
    # 只在 base 就是小世界根目录时合并，子目录 list 的 count/used_bytes 仍是全库口径（回退 _world_usage）] [注释时间 2026-10-27]
    items = []
    total, count = 0, 0
    at_root = os.path.realpath(base) == os.path.realpath(WORLD_ROOT)
    for dp, dns, fns in os.walk(base):
        dns[:] = sorted(d for d in dns if not d.startswith("."))
        for fn in sorted(fns):
            fp = os.path.join(dp, fn)
            try:
                st = os.stat(fp)
            except OSError:
                continue
            if at_root:
                total += st.st_size
                count += 1
            if fn.startswith("."):
                continue
            if len(items) < 300:
                items.append({"path": _world_rel(fp), "size": st.st_size,
                              "updated": datetime.datetime.fromtimestamp(st.st_mtime).strftime("%Y-%m-%d %H:%M")})
    if not at_root:
        total, count = _world_usage()
    # [位置:tools_server.py·tool_world_list 返回] [批2：配额数字只在用量超 80% 时返回] [2026-10-28]
    out = {"files": items}   # [批3精简（11-05）：base_url 恒定砍（页面地址在工具描述里）；count 砍（10-28）：和 files 条数重复，文件数接近上限时才给] [2026-11-05]
    if count * 5 >= WORLD_MAX_FILES * 4:
        out["count"] = count
        out["max_files"] = WORLD_MAX_FILES
    if total * 5 >= WORLD_MAX_TOTAL * 4:
        out["used_bytes"] = total
        out["quota_bytes"] = WORLD_MAX_TOTAL
    return out


def tool_world_read(args):
    real, err = _world_path(args.get("path"))
    if err:
        return err
    if not os.path.isfile(real):
        return {"error": "文件不存在：" + str(args.get("path"))}
    with open(real, encoding="utf-8", errors="replace") as f:
        text = f.read()
    total_lines = text.count("\n") + (1 if text and not text.endswith("\n") else 0)
    out = {"size": len(text.encode("utf-8")), "url": ((WORLD_URL + "/" + _world_rel(real)) if WORLD_URL else _world_rel(real)), "total_lines": total_lines}
    # [位置:tools_server.py·tool_world_read 分段读] [read 可带 start_line/end_line 定点看片段省 token，返回带行号] [注释时间 2026-11-07]
    start, end = args.get("start_line"), args.get("end_line")
    if start not in (None, "") or end not in (None, ""):
        try:
            start = 1 if start in (None, "") else int(start)
            end = 0 if end in (None, "") else int(end)
        except (TypeError, ValueError):
            return {"error": "start_line / end_line 需为整数行号（1 起）"}
        if start < 1:
            return {"error": "start_line 从 1 起，收到：%d" % start}
        if end and end < start:
            return {"error": "end_line(%d) 不能小于 start_line(%d)" % (end, start)}
        lines = text.split("\n")
        if lines and lines[-1] == "":
            lines.pop()
        if start > total_lines:
            return {"error": "文件共 %d 行，start_line=%d 超出" % (total_lines, start)}
        if not end or end > total_lines:
            end = total_lines
        parts, used, last = [], 0, start - 1
        for i in range(start, end + 1):
            piece = "%d\u2192%s" % (i, lines[i - 1])
            if parts and used + len(piece) + 1 > WORLD_READ_MAX:
                break
            parts.append(piece)
            used += len(piece) + 1
            last = i
        out.update({"content": "\n".join(parts), "start_line": start, "end_line": last, "numbered": True})
        if last < end:
            out["truncated"] = True
        return out
    if len(text) > WORLD_READ_MAX:
        out["content"] = text[:WORLD_READ_MAX]
        out["truncated"] = True
        out["hint"] = "内容超长被截断；用 start_line / end_line 分段看剩余部分"
    else:
        out["content"] = text
    return out


def tool_world_write(args):
    real, err = _world_path(args.get("path"))
    if err:
        return err
    content = args.get("content")
    if not isinstance(content, str):
        return {"error": "content 必填：完整文件内容（文本）"}
    data = content.encode("utf-8")
    if len(data) > WORLD_MAX_FILE:
        return {"error": "单个文件不能超过 %d KB（这次 %d KB）" % (WORLD_MAX_FILE // 1024, len(data) // 1024)}
    if os.path.isdir(real):
        return {"error": "这个路径是目录：" + str(args.get("path"))}
    with _world_lock:
        total, count = _world_usage()
        old = os.path.getsize(real) if os.path.isfile(real) else 0
        if not old and count >= WORLD_MAX_FILES:
            return {"error": "小世界文件数已达上限 %d，先删掉一些" % WORLD_MAX_FILES}
        if total - old + len(data) > WORLD_MAX_TOTAL:
            return {"error": "小世界总容量 %d MB 已满，先删掉一些" % (WORLD_MAX_TOTAL // 1024 // 1024)}
        os.makedirs(os.path.dirname(real), exist_ok=True)
        tmp = real + ".tmp-" + str(os.getpid())
        with open(tmp, "wb") as f:
            f.write(data)
        os.replace(tmp, real)
    # [位置:tools_server.py·world_write 返回] [批3精简（11-05）：path/size/url 回显或可推知砍；created（新建还是覆盖）保留] [注释时间 2026-11-05]
    return {"ok": True, "created": not old}


def tool_world_edit(args):
    # [位置:tools_server.py·tool_world_edit] [world edit：old/new 定点替换 + append 追加，改已有文件免整页重写] [注释时间 2026-11-07]
    real, err = _world_path(args.get("path"))
    if err:
        return err
    if not os.path.isfile(real):
        return {"error": "文件不存在（edit 只改已有文件，新建用 write）：" + str(args.get("path"))}
    append = args.get("append") is True or str(args.get("append")).strip().lower() == "true"
    replace_all = args.get("replace_all") is True or str(args.get("replace_all")).strip().lower() == "true"
    new = args.get("new")
    if not isinstance(new, str):
        return {"error": "new 必填：edit 是替换成的内容（删掉 old 就传空字符串）；append=true 时是追加的内容"}
    try:
        with open(real, encoding="utf-8") as f:
            text = f.read()
    except UnicodeDecodeError:
        return {"error": "这个文件不是有效 UTF-8，没法 edit，请用 write 整体重写"}
    if append:
        data = text if text.endswith("\n") else (text + "\n" if text else "")
        data += new
        hits = 0
    else:
        old = args.get("old")
        if not isinstance(old, str) or not old:
            return {"error": "old 必填：要替换的原文（从 read 结果原样复制，含空格缩进换行）"}
        if old == new:
            return {"error": "old 和 new 完全相同，没有要改的"}
        hits = text.count(old)
        if hits == 0:
            return {"error": "old 在文件里没找到（要和 read 到的原文一字不差，含空格缩进）；先 action=read 确认，别把分段读的行号前缀复制进去"}
        if hits > 1 and not replace_all:
            return {"error": "old 命中 %d 处：多带前后几行让它唯一再试，或 replace_all=true 全部替换" % hits}
        data = text.replace(old, new) if replace_all else text.replace(old, new, 1)
        if not replace_all:
            hits = 1
    data_b = data.encode("utf-8")
    if len(data_b) > WORLD_MAX_FILE:
        return {"error": "改完的单个文件不能超过 %d KB（这次 %d KB）" % (WORLD_MAX_FILE // 1024, len(data_b) // 1024)}
    with _world_lock:
        total, _ = _world_usage()
        old_size = os.path.getsize(real)
        if total - old_size + len(data_b) > WORLD_MAX_TOTAL:
            return {"error": "小世界总容量 %d MB 已满，先删掉一些" % (WORLD_MAX_TOTAL // 1024 // 1024)}
        tmp = real + ".tmp-" + str(os.getpid())
        with open(tmp, "wb") as f:
            f.write(data_b)
        os.replace(tmp, real)
    rel = _world_rel(real)
    # [位置:tools_server.py·world_edit 返回] [批3精简（11-05 同口径补）：path/size/url 回显或可推知砍；hits（替换了几处）是真实结果信息保留；appended 等于 new 长度砍] [注释时间 2026-11-08]
    out = {"ok": True}
    if not append:
        out["hits"] = hits
    return out


def tool_world_delete(args):
    real, err = _world_path(args.get("path"))
    if err:
        return err
    if not os.path.isfile(real):
        return {"error": "文件不存在：" + str(args.get("path"))}
    rel = _world_rel(real)
    with _world_lock:
        os.remove(real)
        d = os.path.dirname(real)
        root = os.path.realpath(WORLD_ROOT)
        while d != root and d.startswith(root + os.sep) and not os.listdir(d):
            os.rmdir(d)
            d = os.path.dirname(d)
    return {"ok": True}   # [批3精简（11-05）：path 回显砍（批2 已砍恒定 message）] [2026-11-05]


def tool_world(args):
    action, err = _pick_action(args, ("list", "read", "write", "edit", "delete"))
    if err:
        return err
    try:
        os.makedirs(WORLD_ROOT, exist_ok=True)
        if action == "list":
            return tool_world_list(args)
        if action == "read":
            return tool_world_read(args)
        if action == "write":
            return tool_world_write(args)
        if action == "edit":
            return tool_world_edit(args)
        return tool_world_delete(args)
    except Exception as e:
        return {"error": "小世界操作失败: %s" % e}


TOOLS["world"] = {
    # [位置:tools_server.py·TOOLS.world] [小世界工具入口] [11-07 加 edit（old/new 定点替换 + append 追加）与 read 分段（start_line/end_line 带行号），改已有文件免整页重写] [注释时间 2026-11-07]
    "description": "管理小世界静态页面文件（她在小手机「小世界」页查看；仅允许文本类文件如 html/css/js/json/md/txt/svg/csv/xml，单文件不超过 512KB、总量不超过 20MB，不可执行命令）。action=\"list\" 列出目录（path 为空即根目录）；action=\"read\" 读取文件内容（返回带行号，可配 start_line 与 end_line 分段读以节省上下文）；action=\"write\" 传入 path 与完整 content 新建或整份覆盖；action=\"edit\" 局部修改已有文件，传 old 与 new（old 须从 read 原样复制且唯一命中，replace_all=true 全替换，new 空串即删除），或传 append=true 与 new 追加到文件末尾；action=\"delete\" 删除指定文件。小改动优先用 edit/append，新建或大幅重构再用 write。",
    "inputSchema": {
        "type": "object",
        "properties": {
            "action": {"type": "string", "enum": ["list", "read", "write", "edit", "delete"], "description": "要执行的操作：list / read / write / edit / delete"},
            "path": {"type": "string", "description": "相对小世界根目录的路径，如 index.html、room/notes.md；list 可留空表示根目录"},
            "content": {"type": "string", "description": "write 必填：完整文件内容"},
            "old": {"type": "string", "description": "edit 必填：要替换的原文，从 read 结果原样复制（含空格缩进换行），须唯一命中"},
            "new": {"type": "string", "description": "edit 必填：替换成的内容（空串=删掉 old）；append=true 时为追加内容"},
            "replace_all": {"type": "boolean", "description": "edit 可选：true=替换所有命中（默认只替换一处；多处命中且没开它会报错）"},
            "append": {"type": "boolean", "description": "edit 可选：true=把 new 追加到文件末尾（原文件末尾没换行会先补一个），此时不用 old"},
            "start_line": {"type": "integer", "description": "read 可选：起始行（1 起），和 end_line 搭配看指定片段"},
            "end_line": {"type": "integer", "description": "read 可选：结束行（含），缺省读到末尾"}
        },
        "required": ["action"]
    },
    "handler": tool_world
}


# ===== 统一工具集：把搜索、云服务器、网易云工具代理到本 MCP 入口 =====
MCP_SERVERS_CONFIG_FILE = os.path.join(PROJECT_ROOT, "config/mcp-servers.json")

# ---- 密钥占位符 ${secret:NAME}（2026-11-01）----
# mcp-servers.json 里不再存明文：url / headers 写 ${secret:NAME}，取值在 MCP_SECRETS_FILE（默认项目 config/mcp-secrets.env）（600）。
# 只在发请求时解析；_read_proxy_server_configs 返回的仍是带占位符的原样，日志里打印的 url 不会带出明文。
import re as _re_sec
_SECRETS_FILE = os.environ.get("MCP_SECRETS_FILE", "").strip() or os.path.join(PROJECT_ROOT, "config", "mcp-secrets.env")
_SECRETS_CACHE = {"mtime": None, "map": {}}
_SECRET_PH = _re_sec.compile(r"\$\{secret:([A-Za-z0-9_]+)\}")
_SECRET_WARNED = set()

def _load_secrets():
    try:
        mt = os.stat(_SECRETS_FILE).st_mtime
        if mt == _SECRETS_CACHE["mtime"]:
            return _SECRETS_CACHE["map"]
        m = {}
        with open(_SECRETS_FILE, encoding="utf-8") as f:
            for line in f:
                line = line.rstrip("\r\n")
                if not line.strip() or line.lstrip().startswith("#") or "=" not in line:
                    continue
                k, v = line.split("=", 1)
                v = v.strip()
                if len(v) >= 2 and v[0] == v[-1] and v[0] in "\"'":
                    v = v[1:-1]
                m[k.strip()] = v
        _SECRETS_CACHE["mtime"], _SECRETS_CACHE["map"] = mt, m
        return m
    except Exception:
        return _SECRETS_CACHE["map"]

def _resolve_secrets(value):
    if isinstance(value, str):
        if "${secret:" not in value:
            return value
        m = _load_secrets()
        def _sub(mo):
            name = mo.group(1)
            if name in m:
                return m[name]
            if os.environ.get(name):
                return os.environ[name]
            if name not in _SECRET_WARNED:
                _SECRET_WARNED.add(name)
                print("[proxy-tools] 密钥占位符 %s 未找到（%s），保持原样" % (name, _SECRETS_FILE), flush=True)
            return mo.group(0)
        return _SECRET_PH.sub(_sub, value)
    if isinstance(value, dict):
        return {k: _resolve_secrets(v) for k, v in value.items()}
    if isinstance(value, list):
        return [_resolve_secrets(v) for v in value]
    return value
PROXY_TOOLS_FILE = os.path.join(os.path.dirname(os.path.abspath(__file__)), "proxy_tools.json")
NETEASE_PLAYLIST_ID = os.environ.get("NETEASE_PLAYLIST_ID", "").strip()

def _read_proxy_server_configs():
    try:
        with open(MCP_SERVERS_CONFIG_FILE, encoding="utf-8") as f:
            cfg = json.load(f)
        return {str(s.get("name")): s for s in cfg.get("servers", []) if s.get("name")}
    except Exception as e:
        print("[proxy-tools] 读取 MCP 服务配置失败:", e, flush=True)
        return {}

def _parse_mcp_http_body(body, content_type):
    text = (body or "").strip()
    if not text:
        return {}
    # [位置:tools_server.py·_parse_mcp_http_body] [SSE 判定收窄] [2026-10-27 审查：原来子串 `"data:" in text`
    # 会把内容里碰巧带 data: 的正常 JSON（歌词等）误判成事件流，拆不出 data: 行就替换成 "{}" 报「未返回 result」；
    # 改成 content-type 或「文本以 data: 开头」才当 SSE] [注释时间 2026-10-27]
    if "text/event-stream" in (content_type or "") or text.startswith("data:"):
        data_lines = [line[5:].strip() for line in text.splitlines() if line.startswith("data:")]
        text = next((line for line in reversed(data_lines) if line and line != "[DONE]"), "{}")
    data = json.loads(text)
    if isinstance(data, dict) and data.get("error"):
        err = data["error"]
        raise RuntimeError(str(err.get("message") or err))
    return data

def _proxy_mcp_rpc(server_cfg, method, params=None, request_id=1, session_id=None):
    payload = {"jsonrpc": "2.0", "id": request_id, "method": method, "params": params or {}}
    headers = {
        "Content-Type": "application/json",
        "Accept": "application/json, text/event-stream",
        "User-Agent": "Mozilla/5.0 (compatible; Unified-MCP-Toolset/1.0)",
    }
    headers.update(_resolve_secrets(server_cfg.get("headers") or {}))
    if session_id:
        headers["Mcp-Session-Id"] = session_id
    req = urllib.request.Request(_resolve_secrets(server_cfg["url"]), data=json.dumps(payload).encode("utf-8"), headers=headers, method="POST")
    try:
        # [位置:tools_server.py·_proxy_mcp_rpc 超时] [40→18s] [2026-10-27 审查：每次调用串行三段 RPC，
        # 40s 最坏 120s 远超网关 60s 客户端超时；上游正常都是秒回，18s 足够容错] [注释时间 2026-10-27]
        with urllib.request.urlopen(req, timeout=18) as resp:
            body = resp.read().decode("utf-8", errors="replace")
            next_session = resp.headers.get("Mcp-Session-Id") or session_id
            return _parse_mcp_http_body(body, resp.headers.get("Content-Type", "")), next_session
    except urllib.error.HTTPError as e:
        # [位置:tools_server.py·_proxy_mcp_rpc 报错瘦身] [上游响应体细节留日志，AI 只拿一句话] [2026-10-28 批1]
        try:
            detail = e.read().decode("utf-8", errors="replace")[:300]
        except Exception:
            detail = ""
        print("[proxy-tools] %s HTTP %s: %s" % (server_cfg.get("url"), e.code, detail), flush=True)
        raise RuntimeError("上游服务 HTTP %s（%s），请稍后重试" % (e.code, e.reason))

def _proxy_mcp_tool(server_name, tool_name, args):
    servers = _read_proxy_server_configs()
    server_cfg = servers.get(server_name)
    if not server_cfg or not server_cfg.get("url"):
        return {"isError": True, "content": [{"type": "text", "text": "找不到上游 MCP 服务配置: " + server_name}]}
    try:
        _, session_id = _proxy_mcp_rpc(server_cfg, "initialize", {
            "protocolVersion": "2025-03-26",
            "capabilities": {},
            "clientInfo": {"name": "unified-mcp-toolset", "version": "1.0.0"},
        }, request_id=1)
        try:
            _proxy_mcp_rpc(server_cfg, "notifications/initialized", {}, request_id=2, session_id=session_id)
        except Exception:
            pass
        response, _ = _proxy_mcp_rpc(server_cfg, "tools/call", {
            "name": tool_name,
            "arguments": args or {},
        }, request_id=3, session_id=session_id)
        if not isinstance(response, dict) or "result" not in response:
            raise RuntimeError("上游 MCP 未返回 result")
        return {"__mcp_raw_result__": response["result"]}
    except Exception as e:
        print("[proxy-tools] %s.%s 调用失败: %s" % (server_name, tool_name, e), flush=True)
        return {"__mcp_raw_result__": {"isError": True, "content": [{"type": "text", "text": "%s 调用失败: %s" % (tool_name, e)}]}}

def register_proxy_tools():
    """从固定的工具清单注册代理工具；工具说明/schema 固定保存，不依赖上游启动时在线。"""
    try:
        with open(PROXY_TOOLS_FILE, encoding="utf-8") as f:
            manifest = json.load(f)
        count = 0
        for item in manifest.get("tools", []):
            name = item.get("toolName")
            server_name = item.get("serverName")
            if not name or not server_name:
                continue
            if name in TOOLS:
                raise RuntimeError("代理工具名称冲突，拒绝覆盖本地工具: " + name)
            def handler(args, _server=server_name, _name=name):
                # 若配置了 NETEASE_PLAYLIST_ID，playlistId 由代理层补上（对外 schema 里已去掉该参数）
                if _name == "netease_playlist_add_songs":
                    args = dict(args or {})
                    args["playlistId"] = NETEASE_PLAYLIST_ID if NETEASE_PLAYLIST_ID else args.get("playlistId")
                return _proxy_mcp_tool(_server, _name, args)
            TOOLS[name] = {
                "description": item.get("description") or ("代理调用 " + server_name + " 的 " + name),
                "inputSchema": item.get("inputSchema") or {"type": "object", "properties": {}},
                "handler": handler,
            }
            count += 1
        print("[proxy-tools] 已注册 %d 个上游工具" % count, flush=True)
    except Exception as e:
        print("[proxy-tools] 注册代理工具失败: %s" % e, flush=True)

# ===== 网易云（2026-10-25 合并）：6 个代理工具拍成 1 个 netease 工具，action 区分 =====
# [位置:tools_server.py·tool_netease] [网易云六合一] [10-25：netease_search/recent_play/lyrics/music_listen/playlist_add_songs/push_to_phone 六个工具占六行，拍成 1 个 netease，像 world/period 一样 action 区分；上游不变：本机 3303 的 netease-music-mcp 与 6 个上游工具名原样保留，本函数只做 action 分发后走 _proxy_mcp_tool；proxy_tools.json 已清空不再注册旧工具；6 个旧名进 _LEGACY_TOOLS 兜底（不对外列出，照 period/context 合并先例）。add_to_playlist 沿用原代理逻辑：「谢」歌单 playlistId 与 confirm 由这里统一补，模型只传 songIds] [注释时间 2026-10-25] */
_NETEASE_UPSTREAM = "网易云"  # mcp-servers.json 里的上游服务名（_read_proxy_server_configs 按 name 取）

_NETEASE_ACTIONS = {
    "search":          ("netease_search",           ("query",)),
    "recent":          ("netease_recent_play",      ()),
    "lyrics":          ("netease_lyrics",           ("songId",)),
    "listen":          ("netease_music_listen",     ("song",)),
    "add_to_playlist": ("netease_playlist_add_songs", ("songIds",)),
    "push":            ("netease_push_to_phone",    ("songid",)),
}

def tool_netease(args):
    action, err = _pick_action(args, tuple(_NETEASE_ACTIONS))
    if err:
        return err
    up, required = _NETEASE_ACTIONS[action]
    # 11-04：对外统一用 song / songs，这里映射回上游各自的字段名（旧写法 songId/songid/songIds 仍兼容）
    args = dict(args or {})
    _s, _ss = args.get("song"), args.get("songs")
    if action == "lyrics" and _s: args["songId"] = _s
    elif action == "push" and _s: args["songid"] = _s
    elif action == "add_to_playlist" and _ss: args["songIds"] = _ss if isinstance(_ss, (list, tuple)) else [x.strip() for x in str(_ss).split(",") if x.strip()]
    for k in required:
        v = args.get(k)
        if v is None or v == "" or (isinstance(v, (list, tuple)) and not v):
            return {"error": "action=%s 缺必填参数：%s" % (action, {"songId":"song","songid":"song","songIds":"songs"}.get(k,k))}
    if action == "add_to_playlist":
        args = dict(args or {})
        args["playlistId"] = NETEASE_PLAYLIST_ID if NETEASE_PLAYLIST_ID else args.get("playlistId")
        args["confirm"] = True
    res = _proxy_mcp_tool(_NETEASE_UPSTREAM, up, args)
    # [位置:tools_server.py·tool_netease 出口加工] [批3精简（11-05）：search 砍 total/durationMs/pageUrl（歌曲 id 能拼链接）；
    # recent 砍 durationSec（11-04 已砍 account/durationMin）；lyrics 砍 songId 回显、空歌词字段与恒 false 标记] [注释时间 2026-11-05]
    def _reshape(fn):
        try:
            c = res["__mcp_raw_result__"]["content"][0]
            j = json.loads(c["text"])
            fn(j)
            c["text"] = json.dumps(j, ensure_ascii=False)
        except Exception:
            pass
    if action == "recent":
        def _f(j):
            j.pop("account", None)
            for t in j.get("tracks") or []:
                if isinstance(t, dict):
                    t.pop("durationMin", None)
                    t.pop("durationSec", None)
        _reshape(_f)
    elif action == "search":
        def _f(j):
            j.pop("total", None)
            for t in j.get("songs") or []:
                if isinstance(t, dict):
                    t.pop("durationMs", None)
                    t.pop("pageUrl", None)
        _reshape(_f)
    elif action == "lyrics":
        def _f(j):
            j.pop("songId", None)
            for k in ("lyric", "translatedLyric", "romanizedLyric"):
                if not str(j.get(k) or "").strip():
                    j.pop(k, None)
            for k in ("noLyric", "uncollected"):
                if not j.get(k):
                    j.pop(k, None)
        _reshape(_f)
    return res

TOOLS["netease"] = {
    "description": "连接网易云音乐进行查歌、听歌与推歌。action=\"search\" 传入 query 搜歌（limit 默认 10 最大 20，支持 offset 翻页）；action=\"recent\" 查看她最近一周的听歌记录（limit 默认 5 最大 20）；action=\"lyrics\" 传入歌曲 id（song）获取歌词、翻译与罗马音；action=\"listen\" 传入歌曲 id 或分享链接（song）读取歌曲音乐结构（VIP 曲目可能受限）；action=\"add_to_playlist\" 传入 1-100 个歌曲 id（songs）加入她的「谢」歌单；action=\"push\" 传入单个歌曲 id（song）推送到她手机播放。",
    "inputSchema": {
        "type": "object",
        "properties": {
            "action": {"type": "string", "enum": ["search", "recent", "lyrics", "listen", "add_to_playlist", "push"], "description": "search=搜歌；recent=她最近在听；lyrics=歌词；listen=音乐结构；add_to_playlist=加进「谢」歌单；push=她手机上放歌"},
            "query": {"type": "string", "description": "search：歌曲、歌手或关键词"},
            "limit": {"type": "integer", "description": "search / recent：返回条数（search 默认 10 最大 20；recent 默认 5 最大 20）"},
            "offset": {"type": "integer", "description": "search：翻页偏移"},
            "song": {"type": "string", "description": "lyrics / push：歌曲 id（push 一次一首）；listen：歌曲 id 或网易云分享链接（163cn.tv/...）"},
            "songs": {"type": "array", "items": {"type": "string"}, "description": "add_to_playlist：1-100 个歌曲 id"}
        },
        "required": ["action"]
    },
    "handler": tool_netease
}

# 截图 / 看图 / 子智能体（11-04 从 yun-mcp-v2 复制进工具集，见 vision_tools.py）
import vision_tools as _vision_tools
_vision_tools.register(TOOLS)

# 旧名兜底：合并前用过的 6 个名字仍可调用（:2086 调用侧 TOOLS.get or _LEGACY_TOOLS.get），但不在 tools/list 里出现
for _n, _legacy_action in (("netease_search", "search"), ("netease_recent_play", "recent"), ("netease_lyrics", "lyrics"), ("netease_music_listen", "listen"), ("netease_playlist_add_songs", "add_to_playlist"), ("netease_push_to_phone", "push")):
    # 2026-10-26 修 bug：循环变量原来叫 _act，把 579 行的动作分发函数 _act() 覆盖成了字符串，
    # 导致 lovediary/her_murmurs/album/period/mood 全部 'str' object is not callable。改名修复。
    def _netease_legacy(args, _a=_legacy_action):
        _args = dict(args or {})
        _args["action"] = _a
        return tool_netease(_args)
    _LEGACY_TOOLS[_n] = {
        "description": "（已合并进 netease 工具，此为旧名兜底入口）",
        "inputSchema": {"type": "object", "properties": {}},
        "handler": _netease_legacy,
    }



# ===== MCP HTTP 处理器 =====
class MCPHandler(BaseHTTPRequestHandler):
    def do_OPTIONS(self):
        self.send_response(204)
        self.send_header('Access-Control-Allow-Origin', '*')
        self.send_header('Access-Control-Allow-Methods', 'POST, OPTIONS')
        self.send_header('Access-Control-Allow-Headers', 'Content-Type, Authorization')
        self.end_headers()

    def do_POST(self):
        # ── 鉴权检查 ──
        # [位置:tools_server.py·do_POST 日志] [2026-10-27 审查：原来请求行 print 在鉴权之前，任何人不带 token 也能
        # 灌日志（无轮转，可写满磁盘）；body 的 %r 打的是她和 AI 的原始对话（隐私，且中文变字节串没法看）。
        # 现在鉴权通过才打请求行、body 只打长度] [注释时间 2026-10-27]
        auth = self.headers.get('Authorization', '')
        if auth != f'Bearer {API_TOKEN}':
            self.send_response(401)
            self.send_header('Content-Type', 'application/json')
            self.send_header('Access-Control-Allow-Origin', '*')
            self.end_headers()
            self.wfile.write(json.dumps({
                "jsonrpc": "2.0",
                "error": {"code": -32001, "message": "Unauthorized: 无效的 Authorization Token"}
            }, ensure_ascii=False).encode('utf-8'))
            return

        try:
            content_length = int(self.headers.get('Content-Length', 0))
        except (TypeError, ValueError):
            content_length = -1
        if content_length < 0 or content_length > 2 * 1024 * 1024:
            self.send_response(400 if content_length < 0 else 413)
            self.send_header('Content-Type', 'application/json')
            self.send_header('Access-Control-Allow-Origin', '*')
            self.end_headers()
            self.wfile.write(json.dumps({"jsonrpc": "2.0", "id": None, "error": {"code": -32600, "message": "invalid request body"}}, ensure_ascii=False).encode('utf-8'))
            return
        post_data = self.rfile.read(content_length)
        print("[req] POST %s (%d bytes)" % (self.path, len(post_data)), flush=True)
        req = None
        try:
            req = json.loads(post_data.decode('utf-8'))
            resp = self.handle_request(req)
        except Exception as e:
            resp = {"jsonrpc": "2.0", "id": None, "error": {"code": -32700, "message": str(e)}}

        # MCP streamable HTTP: JSON-RPC 通知（有 method 无 id）不回响应体，按规范回 202
        if isinstance(req, dict) and req.get("method") and "id" not in req:
            self.send_response(202)
            self.send_header('Access-Control-Allow-Origin', '*')
            self.end_headers()
            return

        # MCP streamable HTTP: POST 响应用 SSE 单条消息包裹（与 FastMCP/官方 SDK 行为一致）；
        # OpenAI 客户端只接受 text/event-stream 响应，裸 application/json 会在 initialize 后被放弃
        self.send_response(200)
        self.send_header('Content-Type', 'text/event-stream')
        self.send_header('Cache-Control', 'no-cache, no-transform')
        self.send_header('Access-Control-Allow-Origin', '*')
        self.end_headers()
        self.wfile.write(('event: message\ndata: ' + json.dumps(resp, ensure_ascii=False) + '\n\n').encode('utf-8'))

    def handle_request(self, req):
        method = req.get("method")
        req_id = req.get("id")
        params = req.get("params", {})

        if method == "initialize":
            # 2026-09-19: 回显客户端请求的版本号；实测 yun(FastMCP) 无条件回显任意版本且各客户端可通，
            # 白名单外版本回退旧版会让严格客户端按规范断开
            client_ver = params.get("protocolVersion", "2025-03-26")
            print("[init] client protocolVersion=%r" % (client_ver,), flush=True)
            return {
                "jsonrpc": "2.0", "id": req_id,
                "result": {
                    "protocolVersion": client_ver or "2025-03-26",
                    "capabilities": {"tools": {}},
                    "serverInfo": {"name": "小世界MCP工具集", "version": "1.0.0"}
                }
            }
        if method == "ping":
            return {"jsonrpc": "2.0", "id": req_id, "result": "pong"}

        if method == "tools/list":
            tool_list = []
            for name, t in TOOLS.items():
                tool_list.append({
                    "name": name,
                    "description": t["description"],
                    "inputSchema": t["inputSchema"]
                })
            return {"jsonrpc": "2.0", "id": req_id, "result": {"tools": tool_list}}

        if method == "tools/call":
            tool_name = params.get("name")
            args = params.get("arguments", {})
            # 2026-10-16~22：旧工具名（memory_add 等）曾为冻结快照保留兜底调用；10-22 确认无会话再用，已删。
            call_tool = TOOLS.get(tool_name) or _LEGACY_TOOLS.get(tool_name)   # 2026-10-22：合并前的旧名字仍可调用（不对外列出）
            if call_tool is None or not call_tool.get("handler"):
                return {
                    "jsonrpc": "2.0", "id": req_id,
                    "error": {"code": -32601, "message": f"未知工具: {tool_name}"}
                }
            try:
                result = call_tool["handler"](args)
                # 代理工具直接透传上游 MCP 的 result，避免把原始 content 再套一层 JSON 文本。
                if isinstance(result, dict) and "__mcp_raw_result__" in result:
                    return {"jsonrpc": "2.0", "id": req_id, "result": result["__mcp_raw_result__"]}
                return {
                    "jsonrpc": "2.0", "id": req_id,
                    # [位置:tools_server.py·tools/call 返回] [紧凑JSON] [10-28 批1：indent=2 的缩进换行
                    # 占返回 10-20% 字符、对 AI 无信息量，改紧凑单行省上下文] [注释时间 2026-10-28]
                    "result": {"content": [{"type": "text", "text": json.dumps(_localize_times(result), ensure_ascii=False)}]}
                }
            except Exception as e:
                return {
                    "jsonrpc": "2.0", "id": req_id,
                    "error": {"code": -32000, "message": str(e)}
                }

        # JSON-RPC 2.0 规范：未知方法必须回 -32601 错误（回 200 空 result 会让 openai-mcp 的
        # server/discover 探测拿到"成功但无效"的响应而不回退标准 initialize 流程）
        return {"jsonrpc": "2.0", "id": req_id, "error": {"code": -32601, "message": "Method not found: %s" % method}}

    def do_GET(self):
        # MCP streamable HTTP 客户端握手后会 GET 开 SSE 流；本服务不支持流式，
        # 按规范回 405 让客户端降级为纯 POST（对任意路径 405）。
        # 原白兰访问计数接口（/baillan-visit）已于 2026-09-19 经用户拍板移除：数据目录一直缺失、功能从未生效、无前端调用方。
        self.send_response(405)
        self.send_header('Allow', 'POST')
        self.send_header('Access-Control-Allow-Origin', '*')
        self.end_headers()

    def log_message(self, fmt, *args):
        pass


    # ── GET: 白兰访问计数（供前端页面调用）──

# ============================================================
# 工具集覆盖配置：管理台可停用工具 / 修改说明 / 修改参数 schema
# 配置文件：tools_config.json（{disabled:[...], descriptions:{...}, schemas:{...}}）
# 启动时生成 tools_manifest.json（全量工具清单 + enabled 状态，供管理台读取）
# ============================================================
TOOLS_CONFIG_FILE = os.path.join(os.path.dirname(os.path.abspath(__file__)), "tools_config.json")
TOOLS_MANIFEST_FILE = os.path.join(os.path.dirname(os.path.abspath(__file__)), "tools_manifest.json")

_TOOL_REGISTRY_SNAPSHOT = {}


def _snapshot_registry():
    for name, t in TOOLS.items():
        _TOOL_REGISTRY_SNAPSHOT[name] = {
            "description": t.get("description", ""),
            "inputSchema": t.get("inputSchema", {}),
            "handler": t.get("handler"),
            "defaultDescription": t.get("description", ""),
            "defaultInputSchema": t.get("inputSchema", {}),
        }


def _load_tools_config():
    # [位置:tools_server.py·_load_tools_config] [读失败返回 None（fail-safe）] [2026-10-27 审查：原来读失败返回 {}，
    # 热加载把 disabled 清空——管理台/手工改坏一个逗号，2 秒内全部停用工具被放出来且清单写 enabled:true。
    # 现在读失败返回 None，apply_tools_config 跳过本次、沿用当前生效配置] [注释时间 2026-10-27]
    try:
        if os.path.exists(TOOLS_CONFIG_FILE):
            with open(TOOLS_CONFIG_FILE, encoding="utf-8") as f:
                cfg = json.load(f)
            if isinstance(cfg, dict):
                return cfg
    except Exception as e:
        print("[tools-config] 读取失败，跳过本次应用（沿用当前生效配置）:", e)
    return None


def apply_tools_config():
    global TOOLS
    cfg = _load_tools_config()
    if cfg is None:
        return   # 读失败：沿用当前生效配置，不重建（fail-safe，见 _load_tools_config）
    if not _TOOL_REGISTRY_SNAPSHOT:
        _snapshot_registry()
    # 重置快照为源码默认，再按配置覆盖（保证可重复应用、可恢复停用工具）
    for meta in _TOOL_REGISTRY_SNAPSHOT.values():
        meta["description"] = meta.get("defaultDescription", meta.get("description", ""))
        meta["inputSchema"] = meta.get("defaultInputSchema", meta.get("inputSchema", {}))
    # [位置:tools_server.py·apply_tools_config] [先建新表再整体赋值] [2026-10-27 审查：原来先 TOOLS={} 再逐个填，
    # 并发的 tools/call 在空窗里拿到「未知工具」] [注释时间 2026-10-27]
    new_tools = {}
    for name, meta in _TOOL_REGISTRY_SNAPSHOT.items():
        new_tools[name] = {
            "description": meta["description"],
            "inputSchema": meta["inputSchema"],
            "handler": meta.get("handler"),
        }
    disabled = set(cfg.get("disabled", []) or [])
    for name in list(new_tools.keys()):
        if name in disabled:
            new_tools.pop(name, None)
    descriptions = cfg.get("descriptions", {}) or {}
    schemas = cfg.get("schemas", {}) or {}
    for name, t in new_tools.items():
        if name in descriptions and isinstance(descriptions[name], str) and descriptions[name].strip():
            t["description"] = descriptions[name].strip()
        if name in schemas and isinstance(schemas[name], dict) and schemas[name]:
            t["inputSchema"] = schemas[name]
    for name, meta in _TOOL_REGISTRY_SNAPSHOT.items():
        if name in descriptions and isinstance(descriptions[name], str) and descriptions[name].strip():
            meta["description"] = descriptions[name].strip()
        if name in schemas and isinstance(schemas[name], dict) and schemas[name]:
            meta["inputSchema"] = schemas[name]
    TOOLS = new_tools
    for name in list(TOOLS.keys()):
        if name in disabled:
            TOOLS.pop(name, None)
    descriptions = cfg.get("descriptions", {}) or {}
    schemas = cfg.get("schemas", {}) or {}
    print(f"[tools-config] 停用 {len(disabled & set(_TOOL_REGISTRY_SNAPSHOT.keys()))} 个工具，当前可用 {len(TOOLS)} 个")


def write_tools_manifest():
    try:
        manifest = {
            "server": "小世界MCP工具集",
            "generated_at": time.strftime("%Y-%m-%d %H:%M:%S"),
            "tools": [
                {
                    "name": name,
                    "description": meta["description"],
                    "inputSchema": meta.get("inputSchema", {}),
                    "defaultDescription": meta.get("defaultDescription", meta["description"]),
                    "defaultInputSchema": meta.get("defaultInputSchema", meta.get("inputSchema", {})),
                    "enabled": name in TOOLS,
                }
                for name, meta in sorted(_TOOL_REGISTRY_SNAPSHOT.items())
            ],
        }
        # [位置:tools_server.py·write_tools_manifest] [原子写] [2026-10-27 审查：open(w) 先截断再写，
        # 管理台正好此时读会拿到半截 JSON 解析失败、工具页整页空] [注释时间 2026-10-27]
        tmp = "%s.tmp.%s.%s" % (TOOLS_MANIFEST_FILE, os.getpid(), threading.get_ident())
        with open(tmp, "w", encoding="utf-8") as f:
            json.dump(manifest, f, ensure_ascii=False, indent=2)
        os.replace(tmp, TOOLS_MANIFEST_FILE)
        print(f"[tools-config] 清单已写入 {TOOLS_MANIFEST_FILE}（{len(manifest['tools'])} 个工具）")
    except Exception as e:
        print("[tools-config] 清单写入失败:", e)


def watch_config_loop():
    last_mtime = os.path.getmtime(TOOLS_CONFIG_FILE) if os.path.exists(TOOLS_CONFIG_FILE) else 0
    while True:
        time.sleep(2)
        try:
            if not os.path.exists(TOOLS_CONFIG_FILE):
                continue
            mtime = os.path.getmtime(TOOLS_CONFIG_FILE)
            if mtime != last_mtime:
                last_mtime = mtime
                apply_tools_config()
                write_tools_manifest()
        except Exception as e:
            print("[tools-config] 热加载失败:", e)



if __name__ == "__main__":
    register_proxy_tools()
    apply_tools_config()
    write_tools_manifest()
    threading.Thread(target=watch_config_loop, daemon=True).start()
    LISTEN_HOST = os.environ.get("LISTEN_HOST", "127.0.0.1").strip() or "127.0.0.1"
    print(f"小世界MCP工具集启动 -> http://{LISTEN_HOST}:{PORT}")
    # [位置:tools_server.py·启动自检] [2026-10-27 审查：token 没配上也打印「已加载」，实际全部 401 还看不出来] [注释时间 2026-10-27]
    if not API_TOKEN:
        print("⚠️ 警告: MCP_TOOLS_API_TOKEN 未设置，所有请求都会 401（客户端表现为连不上）", flush=True)
    else:
        print("🔑 鉴权: Bearer Token (API_TOKEN 已从环境变量 MCP_TOOLS_API_TOKEN 加载)")
    print(f"📡 暴露 {len(TOOLS)} 个工具:")
    for name in sorted(TOOLS.keys()):
        print(f"   ├─ {name}")
    server = None
    while True:
        try:
            server = ThreadingHTTPServer((LISTEN_HOST, PORT), MCPHandler)
            server.serve_forever()
        except Exception as e:
            # systemd restart 时旧进程释放端口有间隙：重试间隔 1s（原 5s 会让新进程最长 5 秒无法接管）
            # [位置:tools_server.py·主循环] [2026-10-27 审查：崩溃重试前不关旧 socket，监听句柄泄漏] [注释时间 2026-10-27]
            print(time.strftime("[%F %T]") + f" ⚠️ 服务器崩溃: {e}，1秒后重启...", flush=True)
            if server is not None:
                try: server.server_close()
                except Exception: pass
                server = None
            time.sleep(1)
