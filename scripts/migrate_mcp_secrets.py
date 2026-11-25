#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""把 mcp-servers.json 里的明文密钥迁到 /etc/dylan-heartbeat/mcp-secrets.env。
用法:  extract  备份原文件 + 生成 secrets 文件（不改配置）
       rewrite  把配置里的明文替换成 ${secret:NAME}（要求 extract 已执行）
       check    只检查配置里是否还有明文
全程只打印变量名/数量，不打印任何密钥值。"""

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
import json, os, re, sys, shutil, time
from urllib.parse import urlsplit

BASE = PROJECT_ROOT
CFG = BASE + "/config/mcp-servers.json"
SEC_DIR = "/etc/dylan-heartbeat"
SEC_FILE = SEC_DIR + "/mcp-secrets.env"
BAK_DIR = SEC_DIR + "/backup"
PH = "${secret:%s}"

PREFIX = {
    "15de5875-6caa-4f5f-8aa9-19beba9a02b9": "YUN_MCP",
    "e4a5f214-2e52-475a-92aa-d36f647e2dea": "TOOLS_8771",
    "0626c189-93d7-40cb-8aca-cdc3068d57a0": "MONOPOLY",
    "51fe7fd6-9d7c-4228-913d-0c0cbfbc9b3b": "GALATEA",
    "a16a31bf-1278-4075-b120-a0bbc87893c6": "NETEASE",
    "c365e32e-7834-4410-bd64-55c5dc02e785": "CEDARSTAR_4399",
    "ds-mcp-local": "DS_SEARCH",
    "d69b1213-b397-4762-85bd-edc87aade40d": "GLM_SEARCH",
}
SHARED = "MCP_LOCAL_SHARED_TOKEN"   # 本机几个 MCP 服务共用的同一个 Bearer


def candidates(s):
    """返回 [(kind, secret_value)]，kind 用于命名。已是占位符的跳过。"""
    out = []
    for hk, hv in (s.get("headers") or {}).items():
        if not isinstance(hv, str) or not hv.strip() or "${secret:" in hv:
            continue
        m = re.match(r"^(Bearer|Basic|Token)\s+(.+)$", hv.strip(), re.I)
        if m:
            out.append(("BEARER" if hk.lower() == "authorization" else re.sub(r"\W", "_", hk).upper(), m.group(2).strip()))
        elif re.search(r"(key|token|secret|auth|password)", hk, re.I):
            out.append((re.sub(r"\W", "_", hk).upper(), hv.strip()))
    url = s.get("url") or ""
    if url and "${secret:" not in url:
        sp = urlsplit(url)
        for seg in sp.path.split("/"):
            if len(seg) >= 24 and re.fullmatch(r"[A-Za-z0-9._\-]+", seg):
                out.append(("URL_TOKEN", seg))
        for kv in sp.query.split("&"):
            if "=" in kv:
                k, v = kv.split("=", 1)
                if re.search(r"(key|token|secret|auth|password)", k, re.I) and len(v) >= 8:
                    out.append(("URL_" + re.sub(r"\W", "_", k).upper(), v))
    return out


def plan(cfg):
    servers = cfg.get("servers", [])
    count = {}
    for s in servers:
        for _, v in candidates(s):
            count[v] = count.get(v, 0) + 1
    val2name, used = {}, set()
    for s in servers:
        pre = PREFIX.get(s.get("id")) or re.sub(r"\W", "_", str(s.get("name") or s.get("id"))).upper()
        for kind, v in candidates(s):
            if v in val2name:
                continue
            name = SHARED if count[v] >= 2 and kind == "BEARER" else "%s_%s" % (pre, kind)
            base, i = name, 2
            while name in used:
                name = "%s_%d" % (base, i); i += 1
            used.add(name); val2name[v] = name
    return val2name


def load():
    with open(CFG, encoding="utf-8") as f:
        return json.load(f)


def read_secrets_file():
    m = {}
    try:
        for line in open(SEC_FILE, encoding="utf-8"):
            line = line.rstrip("\n")
            if not line.strip() or line.lstrip().startswith("#") or "=" not in line:
                continue
            k, v = line.split("=", 1)
            m[k.strip()] = v.strip()
    except FileNotFoundError:
        pass
    return m


def apply(cfg, val2name):
    n = 0
    for s in cfg.get("servers", []):
        h = s.get("headers")
        if isinstance(h, dict):
            for hk, hv in list(h.items()):
                if not isinstance(hv, str):
                    continue
                for v, name in val2name.items():
                    if v and v in hv and "${secret:" not in hv:
                        h[hk] = hv.replace(v, PH % name); hv = h[hk]; n += 1
        u = s.get("url")
        if isinstance(u, str):
            for v, name in val2name.items():
                if v and v in u:
                    u = u.replace(v, PH % name); n += 1
            s["url"] = u
    return n


def leftover(cfg, secrets):
    text = json.dumps(cfg, ensure_ascii=False)
    return [k for k, v in secrets.items() if v and v in text]


def main():
    mode = sys.argv[1] if len(sys.argv) > 1 else ""
    if mode == "extract":
        cfg = load()
        val2name = plan(cfg)
        if not val2name:
            print("没有发现需要迁移的明文密钥"); return
        os.makedirs(SEC_DIR, exist_ok=True); os.chmod(SEC_DIR, 0o700)
        os.makedirs(BAK_DIR, exist_ok=True); os.chmod(BAK_DIR, 0o700)
        bak = "%s/mcp-servers.json.orig-%s" % (BAK_DIR, time.strftime("%Y%m%d-%H%M%S"))
        shutil.copy2(CFG, bak); os.chmod(bak, 0o600)
        existing = read_secrets_file()
        lines = ["# MCP 密钥（${secret:NAME} 占位符的取值）。权限 600，不要放进项目目录/备份/git。",
                 "# 生成：%s  由 migrate_secrets.py extract" % time.strftime("%Y-%m-%d %H:%M:%S")]
        merged = dict(existing)
        for v, name in val2name.items():
            if "\n" in v or "\r" in v:
                print("跳过含换行的值:", name); continue
            merged[name] = v
        for k in sorted(merged):
            lines.append("%s=%s" % (k, merged[k]))
        fd = os.open(SEC_FILE, os.O_WRONLY | os.O_CREAT | os.O_TRUNC, 0o600)
        with os.fdopen(fd, "w", encoding="utf-8") as f:
            f.write("\n".join(lines) + "\n")
        os.chmod(SEC_FILE, 0o600)
        print("已生成", SEC_FILE, "，变量数:", len(merged))
        print("变量名:", ", ".join(sorted(merged)))
        print("原配置备份:", bak)
    elif mode == "rewrite":
        secrets = read_secrets_file()
        if not secrets:
            print("secrets 文件为空，先执行 extract"); sys.exit(2)
        cfg = load()
        val2name = {v: k for k, v in secrets.items() if v}
        n = apply(cfg, val2name)
        left = leftover(cfg, secrets)
        if left:
            print("替换后仍有明文，放弃写入:", left); sys.exit(3)
        tmp = CFG + ".tmp-migrate"
        with open(tmp, "w", encoding="utf-8") as f:
            json.dump(cfg, f, ensure_ascii=False, indent=2); f.write("\n")
        shutil.copymode(CFG, tmp)
        os.replace(tmp, CFG)
        print("已改写配置，替换处数:", n)
    elif mode == "check":
        secrets = read_secrets_file()
        left = leftover(load(), secrets)
        print("配置里残留明文的变量:", left if left else "无")
        for s in load().get("servers", []):
            ph = sorted(set(re.findall(r"\$\{secret:([A-Za-z0-9_]+)\}", json.dumps(s, ensure_ascii=False))))
            if ph:
                print(" ", s.get("name"), "->", ", ".join(ph))
    else:
        print(__doc__)


main()
