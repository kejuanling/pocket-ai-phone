#!/usr/bin/python3
"""工具 context（ai-toolbox/tools_server.py）：用假网关替换 urlopen，不碰真服务。
跑法（项目目录下）：/usr/bin/python3 tests/context-tool/test_context_tool.py
覆盖：search 参数/排除说明/片段透传、get 全库定位+撞号全发+window=0+当前会话兜底、time_prefix/latest、旧动作报错、老三件已删"""
import importlib.util
import io
import json
import os
import sys
import urllib.parse

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, os.path.join(HERE, "..", "..", "ai-toolbox"))   # tools_server 同目录的 vision_tools 等
spec = importlib.util.spec_from_file_location("ts", os.path.join(HERE, "..", "..", "ai-toolbox", "tools_server.py"))
ts = importlib.util.module_from_spec(spec)
spec.loader.exec_module(ts)

CALLS = []
ROUTES = {}


class FakeResp(io.BytesIO):
    def __enter__(self):
        return self

    def __exit__(self, *a):
        return False


def fake_urlopen(req, timeout=0):
    url = req.full_url if hasattr(req, "full_url") else req.get_full_url()
    path, _, qs = url.partition("?")
    params = {k: v[0] for k, v in urllib.parse.parse_qs(qs).items()}
    CALLS.append((path.split(":3000")[-1], params))
    h = ROUTES.get(path.split(":3000")[-1])
    return FakeResp(json.dumps(h(params), ensure_ascii=False).encode("utf-8"))


ts.urllib.request.urlopen = fake_urlopen

bad = 0


def ok(c, m):
    global bad
    print(("  PASS " if c else "  FAIL ") + m)
    if not c:
        bad += 1


# ---------- search ----------
ROUTES["/internal/search"] = lambda p: {"ok": True, "total": 2, "excluded_recent": 3, "results": [
    {"sid": "s_cur", "sidx": 1, "msg_id": "m1", "role": "user", "time": 1762650000000, "snippet": "…聊到蓝鲸的饲养方式…", "score": 0.9},
    {"sid": "s_oth", "sidx": 2, "msg_id": "m2", "role": "assistant", "time": 0, "snippet": "蓝鲸真的好大", "score": 0.5}]}
CALLS.clear()
r = ts.tool_context({"q": "蓝鲸 饲养", "session_id": "s_cur"})
p = CALLS[-1][1]
ok(p.get("snip") == "1" and p.get("sid") == "s_cur" and p.get("exclude_sid") == "s_cur" and p.get("exclude_recent_min") == "60", "search(current)：传 snip=1、sid、exclude_sid、exclude_recent_min=60 → %s" % p)
ok(r["matches"][0]["snippet"] == "…聊到蓝鲸的饲养方式…" and "session" not in r["matches"][0] and "content" not in r["matches"][0], "搜当前会话：片段透传，不返回 session / content")
ok("已排除当前会话最近 1 小时的 3 条" in r.get("note", ""), "排除说明进回执 → %s" % r.get("note"))
CALLS.clear()
r = ts.tool_context({"q": "蓝鲸", "scope": "all", "session_id": "s_cur"})
p = CALLS[-1][1]
ok("sid" not in p and p.get("exclude_sid") == "s_cur" and p.get("exclude_recent_min") == "60", "scope=all：不传 sid（否则变成只搜当前会话），但仍排除当前会话最近 1 小时 → %s" % p)
ok(r["matches"][0].get("session") == "s_cur" and r["matches"][1].get("session") == "s_oth", "scope=all：返回 session")
CALLS.clear()
r = ts.tool_context({"q": "蓝鲸", "scope": "all"})
ok("exclude_sid" not in CALLS[-1][1], "拿不到当前会话（非聊天调用）：不排除")
r = ts.tool_context({"q": "蓝鲸"})
ok("error" in r, "非 all 又拿不到会话：报错")
r = ts.tool_context({"q": "  "})
ok("error" in r and "q 必填" in r["error"], "q 为空：报错")
ROUTES["/internal/search"] = lambda p: {"ok": True, "total": 0, "results": []}
r = ts.tool_context({"q": "没有", "session_id": "s_cur"})
ok(r == {"matches": []}, "无结果且没排除：干净的空列表")
ROUTES["/internal/search"] = lambda p: {"ok": False, "error": "boom"}
ok(ts.tool_context({"q": "x", "session_id": "s"}).get("error") == "boom", "网关报错：透传")
ROUTES["/internal/search"] = lambda p: {"ok": True, "results": [{"sid": "s", "msg_id": "m", "role": "user", "time": 1, "snippet": "a"}]}
CALLS.clear()
ts.tool_context({"q": "x", "full_ids": ["m"], "session_id": "s"})
ok("full_ids" not in CALLS[-1][1], "老习惯带 full_ids：被忽略，按普通 search 处理")

# ---------- 旧动作 ----------
r = ts.tool_context({"action": "star", "msg_ids": ["m1"]})
ok("error" in r and "已下线" in r["error"], "action=star：报错并说明 → %s" % r.get("error"))
r = ts.tool_context({"msg_ids": ["m1"]})
ok("error" in r, "只带 msg_ids 不带 action：不静默当 search")
r = ts.tool_context({"action": "list"})
ok("error" in r, "action=list：报错")
ok(not any(n in ts.TOOLS or n in ts._LEGACY_TOOLS for n in ("context_search", "context_star", "context_star_list")), "老三件不在注册表也不在旧名兜底表")
ok(set(ts.TOOLS["context"]["inputSchema"]["properties"]) == {"action", "q", "scope", "limit", "time_prefix", "latest", "ids", "window"}, "schema 里没有 star/list/session/full_ids/msg_ids/marked")
ok("full_ids" not in ts.TOOLS["context"]["description"] and "star：" not in ts.TOOLS["context"]["description"], "描述里不再提 full_ids / star 动作")

# ---------- get ----------
def msgs(sess, mid, ctx):
    rows = [{"msg_id": mid, "role": "user", "time": "t", "text": "命中全文" * 3, "session": sess}]
    if ctx:
        rows[0]["hit"] = True
        rows.insert(0, {"msg_id": "n1", "role": "assistant", "time": "t", "text": "邻" * 600, "hit": False, "session": sess})
    return rows


def gw_messages(p):
    ids = p["ids"].split(",")
    ctx = int(p.get("ctx", "0"))
    sid = p.get("sid")
    if sid:   # 带 sid：只取该会话
        have = {"s_cur": ["a"], "s_x": ["dup"], "s_y": ["dup"], "s_arch_cur": ["only_cur"]}.get(sid, [])
        got = [i for i in ids if i in have]
        out = []
        for i in got:
            out += msgs(sid, i, ctx)
        return {"ok": True, "total": len(out), "messages": out, "missing": [i for i in ids if i not in got]}
    # 全库定位
    where = {"a": ["s_cur"], "dup": ["s_x", "s_y"], "solo": ["s_z"]}
    byS = {}
    missing = []
    for i in ids:
        if i not in where:
            missing.append(i)
            continue
        for s_ in where[i]:
            byS.setdefault(s_, []).append(i)
    if not byS:
        return {"ok": True, "total": 0, "messages": [], "missing": missing}
    if len(byS) == 1:
        s_ = list(byS)[0]
        out = []
        for i in byS[s_]:
            out += msgs(s_, i, ctx)
        return {"ok": True, "total": len(out), "messages": out, "missing": missing}
    return {"ok": False, "multi_session": [{"session": s_, "msg_ids": v} for s_, v in sorted(byS.items())], "missing": missing}


ROUTES["/internal/messages"] = gw_messages
CALLS.clear()
r = ts.tool_context({"action": "get", "ids": ["a"], "session_id": "s_cur"})
ok("sid" not in CALLS[0][1], "get 默认全库定位：第一次调用不带 sid（不用注入的当前会话）→ %s" % CALLS[0][1])
ok("messages" in r and "groups" not in r and len(r["messages"]) == 2, "单会话命中：直接 messages，带上下文")
ok(all("session" not in m and "text" not in m for m in r["messages"]), "每条只有 content，没有 session/text")
nb = [m for m in r["messages"] if m.get("hit") is False][0]
ok(len(nb["content"]) < 520 and nb["content"].endswith("（邻居截断）"), "邻居截 500 字")
r = ts.tool_context({"action": "get", "ids": ["dup"], "session_id": "s_cur"})
ok("groups" in r and [g["session"] for g in r["groups"]] == ["s_x", "s_y"] and all(g["messages"] for g in r["groups"]), "撞号：两个会话的副本全发，按会话分组，不报错 → %s" % [g["session"] for g in r.get("groups", [])])
ok("ambiguous" not in json.dumps(r) and "error" not in r, "撞号：没有 ambiguous / error")
ok("note" in r, "撞号：有分组说明")
CALLS.clear()
r = ts.tool_context({"action": "get", "ids": ["a"], "window": 0, "session_id": "s_cur"})
ok(CALLS[0][1]["ctx"] == "0", "window=0 真的传 ctx=0（不是悄悄变 6）")
ok(len(r["messages"]) == 1 and "hit" not in r["messages"][0], "window=0：只回这一条")
CALLS.clear()
ts.tool_context({"action": "get", "ids": ["a"], "session_id": "s_cur"})
ok(CALLS[0][1]["ctx"] == "6", "window 缺省 = 6")
CALLS.clear()
ts.tool_context({"action": "get", "ids": ["a"], "window": 99, "session_id": "s_cur"})
ok(CALLS[0][1]["ctx"] == "30", "window 超上限夹到 30")
CALLS.clear()
ts.tool_context({"action": "get", "ids": ["a"], "window": "abc", "session_id": "s_cur"})
ok(CALLS[0][1]["ctx"] == "6", "window 不是数字：回默认 6")
r = ts.tool_context({"action": "get", "ids": ["only_cur"], "session_id": "s_arch_cur"})
ok(r.get("messages") and len(r["messages"]) == 2 and "missing" not in r, "全库没找到（当前会话可能在被排除的组里）：用当前会话兜底找到")
r = ts.tool_context({"action": "get", "ids": ["a", "nope"], "session_id": "s_cur"})
ok(r.get("missing") == ["nope"] and r.get("messages"), "部分找不到：missing 列出，找到的照给")
r = ts.tool_context({"action": "get", "ids": ["nope"], "session_id": "s_cur"})
ok(r.get("messages") == [] and r.get("missing") == ["nope"] and "note" in r, "全找不到：空 messages + missing + 说明")
r = ts.tool_context({"action": "get", "ids": "a,solo", "session_id": "s_cur"})
ok("groups" in r and len(r["groups"]) == 2, "不同 id 在不同会话：分组返回（逗号字符串也认）")
r = ts.tool_context({"action": "get"})
ok("error" in r, "get 没给 ids：报错")
ROUTES["/internal/messages"] = lambda p: {"ok": False, "error": "网关炸了"}
r = ts.tool_context({"action": "get", "ids": ["a"]})
ok(r.get("error") == "网关炸了", "网关出错且没有当前会话可兜底：把错误给出去")

# ---------- time_prefix / latest ----------
ROUTES["/internal/context-search"] = lambda p: {"ok": True, "matches": [
    {"session": "s1", "msg_id": "m1", "content": "原文A", "time": "t", "role": "user"},
    {"session": "s1", "msg_id": "m1b", "content": "原文A", "time": "t", "role": "user"},
    {"session": "s2", "msg_id": "m2", "content": "原文B", "time": "t2", "role": "assistant"}]}
CALLS.clear()
r = ts.tool_context({"time_prefix": "2026-08-28", "session_id": "s_cur"})
p = CALLS[-1][1]
ok(CALLS[-1][0] == "/internal/context-search" and p.get("time_prefix") == "2026-08-28" and "q" not in p and p.get("all_sessions") == "0" and "mode" not in p, "time_prefix：走老接口按时间定位，默认 current、不带 q/mode → %s" % p)
ok(r["total"] == 2 and [m["msg_id"] for m in r["matches"]] == ["m1", "m2"], "同内容去重")
CALLS.clear()
r = ts.tool_context({"latest": 5, "scope": "current", "session_id": "s_cur"})
p = CALLS[-1][1]
ok(p.get("latest") == "5" and p.get("all_sessions") == "1", "latest：恒跨全部会话")
r = ts.tool_context({"time_prefix": "2026-08-28", "q": "蓝鲸"})
ok("note" in r and "q 没有参与" in r["note"], "q 与 time_prefix 同给：按时间定位并说明 q 没参与")
ROUTES["/internal/context-search"] = lambda p: {"ok": False, "error": "没有"}
ok(ts.tool_context({"latest": 3}).get("error") == "没有", "老接口报错：透传")

print("RESULT FAIL" if bad else "RESULT ALL PASS")
sys.exit(1 if bad else 0)
