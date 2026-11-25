#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
云服务器 MCP 助手 v2 —— AI 友好的项目文件操作
=================================================
- 独立运行在 9010 端口，与旧版 9000 服务互不影响
- 提供：列目录 / 读文件 / 写文件 / 搜索 / 文件信息 / 执行命令 / 服务器状态 / git 只读操作
- 文件读写受 config.json 白名单限制（写操作只允许项目目录）
- 命令执行改为本地 subprocess，不再 SSH 绕回自己
- 双协议对外：streamable-http（/mcp 标准）+ 传统 SSE（/sse + /messages/，/legacy-sse 为兼容别名）
- 全路径鉴权（X-API-Key / Bearer / Cookie / URL 参数 / 会话 ID）+ CORS，见 AuthMiddleware
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
import contextlib
import fnmatch
import hmac
import json
import os
import re
import stat
import struct
import subprocess
import tempfile
import sys
import time
from datetime import datetime
from pathlib import Path
from urllib.parse import parse_qs

import requests
import uvicorn
from fastmcp import FastMCP
from fastmcp.utilities.types import Image
from fastmcp.server.http import create_sse_app
from mcp.types import TextContent

# ===================== 配置加载 =====================
BASE_DIR = Path(__file__).resolve().parent


def _load_config() -> dict:
    with open(BASE_DIR / "config.json", "r", encoding="utf-8") as f:
        return json.load(f)


CONFIG = _load_config()

API_KEY = str(CONFIG.get("api_key") or "")
if not API_KEY:
    raise RuntimeError("config.json 缺少 api_key（已不再提供写死的默认值）")
DEFAULT_TIMEOUT = int(CONFIG.get("default_timeout", 30))
MAX_OUTPUT = int(CONFIG.get("max_output_chars", 200000))
MAX_LIST_ENTRIES = int(CONFIG.get("max_list_entries", 500))
READ_ROOTS = [Path(p).resolve() for p in CONFIG.get("read_dirs", [])]
WRITE_ROOTS = [Path(p).resolve() for p in CONFIG.get("write_dirs", [])]
DENY_WRITE_ROOTS = [Path(p).resolve() for p in CONFIG.get("deny_write_dirs", [])]

# ===================== 密钥保护（2026-11-01）=====================
# 目的：AI 通过本服务读文件 / 搜索 / 跑命令 / 看 git 时，不把密钥带进对话
#       （对话会存进时间线，也会随上下文发给上游模型）。三层：
#   1) 路径黑名单 DENY_READ_ROOTS：直接存放密钥的位置不让读（_safe_resolve 与 search_text 遍历时拦截）；
#   2) 输出脱敏 _redact：read_file / search_text / run_command / git 的输出统一过一遍；
#   3) write_file 拒绝写入带脱敏标记的内容，防止把脱敏后的读取结果整份写回、抹掉真密钥。
# 边界：run_command 是 root 的 shell，脱敏只挡「不小心读到」，挡不住有意绕过；要硬隔离需让本服务降权运行。
# 新增 / 轮换 MCP 密钥：用 ${PROJECT_ROOT}/scripts/migrate_mcp_secrets.py（见 docs/密钥管理说明.md）。
DENY_READ_ROOTS = [Path(p).resolve() for p in (
    ["/etc/dylan-heartbeat", "/root/oauth", "/root/.ssh", "/root/.git-credentials", "/root/.netrc",
     "/root/.aws", "/root/.aliyun", "/root/.docker", "/root/.gnupg", "/etc/shadow", "/etc/gshadow",
     os.path.join(PROJECT_ROOT, ".ssh"), str(BASE_DIR / "config.json")]
    + list(CONFIG.get("deny_read_dirs", []))
)]

# 标记在运行时拼出来，源码里不出现完整字面量——否则「含标记即拒写」会连改本文件自己也拦住。
REDACT_MARK = "\u00ab" + "已脱敏"


def _mask(name: str = "") -> str:
    return REDACT_MARK + ((":" + name) if name else "") + "\u00bb"


# 已知密钥的来源文件：(路径, 类型)。值从这些文件里读出来，输出里出现原值就替换。
_SECRET_SOURCES = [
    ("/etc/dylan-heartbeat/mcp-secrets.env", "env"),
    (os.path.join(PROJECT_ROOT, ".env"), "env"),
    (str(BASE_DIR / "config.json"), "json"),
    (os.path.join(PROJECT_ROOT, "config/ai-providers.json"), "json"),
    (os.path.join(PROJECT_ROOT, "config/voice-config.json"), "json"),
]
_SENS_WORDS = r"(?:api[_-]?key|apikey|secret|token|passw(?:or)?d|authorization|private[_-]?key|access[_-]?key)"
_SENS_JSON_KEY = re.compile(_SENS_WORDS + r"$", re.I)
_SENS_ENV_NAME = re.compile(r"(?:KEY|TOKEN|SECRET|PASSWORD|PASSWD|PASS|AUTH|CREDENTIAL)", re.I)

# 模式脱敏（没出现在已知来源里的密钥兜底）。刻意收窄，避免把代码里的 API_KEY = ... 之类整片遮掉。
_RE_JSON_SECRET = re.compile(
    r'("[A-Za-z0-9_\-]*' + _SENS_WORDS + r'"\s*:\s*")(?![^"\\]*\$\{secret:)(?![^"\\]*\u00ab)([^"\\]{4,})(")', re.I)
_RE_DOTENV = re.compile(
    r'^(\s*(?:export\s+)?[A-Z][A-Z0-9_]*(?:KEY|TOKEN|SECRET|PASSWORD|PASSWD|PASS|AUTH|CREDENTIAL)[A-Z0-9_]*=)'
    r'(["\']?)(?!\$\{secret:)(?!\u00ab)(?!(?i:true|false|yes|no|on|off|null|none)["\']?\s*(?:#.*)?$)([^\s"\'(){}]{4,})(["\']?)(?=\s*(?:#.*)?$)', re.M)
_RE_BEARER = re.compile(r"(Bearer\s+)(?!\$\{secret:)(?!\u00ab)([A-Za-z0-9._~+/=\-]{16,})")
_RE_JWT = re.compile(r"eyJ[A-Za-z0-9_\-]{8,}\.[A-Za-z0-9_\-]{8,}\.[A-Za-z0-9_\-]{8,}")
_RE_TOKENS = re.compile(
    r"\b(?:sk-[A-Za-z0-9_\-]{20,}|gg_[A-Za-z0-9_\-]{20,}|ghp_[A-Za-z0-9]{30,}|gho_[A-Za-z0-9]{30,}"
    r"|AKIA[0-9A-Z]{16}|AIza[0-9A-Za-z_\-]{30,}|xox[bpa]-[A-Za-z0-9\-]{20,})")

_known_cache = {"sig": None, "pairs": [], "checked": 0.0}


def _collect_json_secrets(obj, out: list) -> None:
    if isinstance(obj, dict):
        for k, v in obj.items():
            if isinstance(v, str) and _SENS_JSON_KEY.search(str(k)) and len(v) >= 8 and "${secret:" not in v:
                out.append(v)
            else:
                _collect_json_secrets(v, out)
    elif isinstance(obj, list):
        for v in obj:
            _collect_json_secrets(v, out)


def _known_secret_pairs() -> list:
    """[(密钥原值, 显示名)]，按长度从长到短。源文件 mtime 变了才重读；2 秒内不重复 stat。"""
    now = time.time()
    if now - _known_cache["checked"] < 2 and _known_cache["sig"] is not None:
        return _known_cache["pairs"]
    _known_cache["checked"] = now
    sig = []
    for fp, _kind in _SECRET_SOURCES:
        try:
            sig.append((fp, os.stat(fp).st_mtime_ns))
        except OSError:
            sig.append((fp, None))
    sig = tuple(sig)
    if sig == _known_cache["sig"]:
        return _known_cache["pairs"]
    pairs = {}
    for fp, kind in _SECRET_SOURCES:
        try:
            with open(fp, encoding="utf-8", errors="ignore") as f:
                text = f.read()
        except OSError:
            continue
        try:
            if kind == "env":
                is_secrets_file = fp.endswith("mcp-secrets.env")
                for line in text.splitlines():
                    line = line.strip()
                    if not line or line.startswith("#") or "=" not in line:
                        continue
                    k, v = line.split("=", 1)
                    k = k.strip()
                    if k.startswith("export "):
                        k = k[7:].strip()
                    v = v.strip().strip("\"'")
                    if len(v) >= 8 and (is_secrets_file or _SENS_ENV_NAME.search(k)) and "${secret:" not in v:
                        pairs.setdefault(v, k if is_secrets_file else "")
            else:
                found = []
                _collect_json_secrets(json.loads(text), found)
                for v in found:
                    pairs.setdefault(v, "")
        except Exception:
            continue
    ordered = sorted(pairs.items(), key=lambda kv: len(kv[0]), reverse=True)
    _known_cache["sig"], _known_cache["pairs"] = sig, ordered
    return ordered


def _is_denied_read(p) -> bool:
    s = str(p)
    for root in DENY_READ_ROOTS:
        rs = str(root).rstrip("/")
        if s == rs or s.startswith(rs + "/"):
            return True
    return False


def _redact(text):
    """输出脱敏：先替换已知密钥原值，再用模式兜底。出错一律隐藏整段（宁可看不到也不泄露）。"""
    if not isinstance(text, str) or not text:
        return text
    try:
        for val, name in _known_secret_pairs():
            if val in text:
                text = text.replace(val, _mask(name))
        text = _RE_JWT.sub(_mask("JWT"), text)
        text = _RE_TOKENS.sub(_mask(), text)
        text = _RE_BEARER.sub(lambda m: m.group(1) + _mask(), text)
        text = _RE_JSON_SECRET.sub(lambda m: m.group(1) + _mask() + m.group(3), text)
        text = _RE_DOTENV.sub(lambda m: m.group(1) + m.group(2) + _mask() + m.group(4), text)
        return text
    except Exception:
        return "（脱敏处理出错，为避免泄露密钥，本段输出已隐藏）"


mcp = FastMCP("云服务器 MCP 助手 v2")

# ===================== 通用工具函数 =====================


def _fmt_size(n: int) -> str:
    if n < 1024:
        return f"{n} B"
    if n < 1024 ** 2:
        return f"{n / 1024:.1f} KB"
    if n < 1024 ** 3:
        return f"{n / 1024 ** 2:.1f} MB"
    return f"{n / 1024 ** 3:.1f} GB"


def _truncate(text: str, limit: int = MAX_OUTPUT) -> str:
    if len(text) <= limit:
        return text
    return text[:limit] + f"\n…（输出过长已截断：共 {len(text)} 字符，仅保留前 {limit} 字符）"


def _safe_resolve(path: str, for_write: bool = False) -> Path:
    """解析为绝对路径，并确保落在白名单内（防符号链接逃逸）。"""
    p = Path(path).expanduser()
    if not p.is_absolute():
        raise ValueError("请使用绝对路径，例如项目根目录下的绝对路径")
    # 先规范化 . / ..，再解析现存路径段，避免 relative_to 对未规范化路径误判。
    p = Path(os.path.abspath(str(p)))
    missing = []
    cur = p
    while not cur.exists() and not cur.is_symlink():
        if cur.parent == cur:
            raise FileNotFoundError(f"无法解析路径: {path}")
        missing.insert(0, cur.name)
        cur = cur.parent
    resolved = cur.resolve(strict=True)
    for part in missing:
        resolved = resolved / part
    roots = WRITE_ROOTS if for_write else (READ_ROOTS + WRITE_ROOTS)
    allowed = False
    for root in roots:
        try:
            resolved.relative_to(root)
            allowed = True
            break
        except ValueError:
            continue
    if not allowed:
        raise PermissionError(f"路径不在允许范围内（可编辑 config.json 调整白名单）: {path}")
    if _is_denied_read(resolved):
        raise PermissionError(f"路径含密钥，禁止通过云工具访问: {path}")
    if for_write:
        for deny in DENY_WRITE_ROOTS:
            try:
                resolved.relative_to(deny)
            except ValueError:
                continue
            raise PermissionError(f"路径属于受保护的系统目录，禁止写入: {path}")
    return resolved


def _read_lines(p: Path, start_line: int, end_line: int, limit: int) -> str:
    start_line = max(1, int(start_line))
    out = []
    total = 0
    with open(p, "r", encoding="utf-8", errors="replace") as f:
        for i, line in enumerate(f, 1):
            if i < start_line:
                continue
            if end_line and i > end_line:
                break
            total += len(line)
            if total > limit:
                out.append(f"…（第 {i} 行起超出输出上限，请缩小行号范围）")
                break
            out.append(f"{i:>6} | {_redact(line.rstrip())}")
    return "\n".join(out)


# ===================== 文件操作工具 =====================


@mcp.tool()
def list_dir(path: str, depth: int = 1, show_hidden: bool = False, max_entries: int = 200) -> str:
    """以紧凑树状结构列出目录。先列完当前目录，再展开子目录，避免大目录吞掉后续结果。
    depth 最多 4 层；max_entries 限制总条目数。默认跳过常见依赖/缓存目录的展开，不跟随符号链接。"""
    depth = max(1, min(int(depth), 4))
    max_entries = max(1, min(int(max_entries), MAX_LIST_ENTRIES))
    root = _safe_resolve(path)
    if not root.is_dir():
        return f"错误: 不是目录: {root}"

    # 这些目录通常体积巨大、对项目结构判断帮助不大；仍显示目录本身，但默认不递归展开。
    skip_expand = {
        'node_modules', '__pycache__', '.git', '.venv', 'venv', 'env',
        'site-packages', '.cache', '.pytest_cache', '.mypy_cache', '.ruff_cache',
        '.next', 'coverage', 'dist', 'build'
    }
    lines = [f"目录: {root}"]
    count = 0
    truncated = False

    def get_entries(d: Path):
        try:
            entries = list(os.scandir(d))
        except (PermissionError, OSError):
            return None
        entries = [e for e in entries if show_hidden or not e.name.startswith('.')]
        def sort_key(e):
            try:
                if e.is_symlink():
                    kind = 1
                elif e.is_dir(follow_symlinks=False):
                    kind = 0
                else:
                    kind = 2
            except OSError:
                kind = 3
            name = e.name.casefold()
            backup_like = (
                name.startswith(('backup_', 'backup-', 'archive', 'recovery_'))
                or name.endswith(('.bak', '.old', '.orig', '.swp', '~', '.tar.gz', '.zip'))
                or '.bak-' in name or '.bak.' in name
            )
            return (kind, 1 if backup_like else 0, name)
        return sorted(entries, key=sort_key)

    def describe(entry, indent):
        nonlocal count, truncated
        if count >= max_entries:
            truncated = True
            return None
        count += 1
        prefix = '  ' * indent
        try:
            if entry.is_symlink():
                try:
                    target = os.readlink(entry.path)
                except OSError:
                    target = '?'
                lines.append(f"{prefix}[LINK] {entry.name} -> {target}")
                return None
            if entry.is_dir(follow_symlinks=False):
                suffix = '（默认不展开）' if entry.name in skip_expand else ''
                lines.append(f"{prefix}[DIR]  {entry.name}/{suffix}")
                return Path(entry.path) if entry.name not in skip_expand else None
            try:
                size = _fmt_size(entry.stat(follow_symlinks=False).st_size)
            except OSError:
                size = '大小未知'
            lines.append(f"{prefix}[FILE] {entry.name} ({size})")
        except OSError:
            lines.append(f"{prefix}[?]    {entry.name}")
        return None

    # 每层先列出所有直接子项，再进入子目录，防止第一个大目录占满整个输出。
    def walk(d: Path, level: int, indent: int):
        entries = get_entries(d)
        if entries is None:
            lines.append('  ' * indent + '[无法读取目录]')
            return
        children = []
        per_dir_limit = 80
        visible_entries = entries[:per_dir_limit]
        for entry in visible_entries:
            child = describe(entry, indent)
            if child is not None and level < depth:
                children.append((child, entry.name))
            if truncated:
                break
        if len(entries) > len(visible_entries) and not truncated:
            lines.append('  ' * indent + f'…本目录另有 {len(entries) - len(visible_entries)} 项未列出')
        for child, name in children:
            if truncated:
                break
            lines.append('  ' * indent + f'展开 {name}/')
            walk(child, level + 1, indent + 1)

    walk(root, 1, 0)
    if truncated:
        lines.append(f'…已达到 max_entries={max_entries} 条上限；可缩小 depth 或指定更具体的 path。')
    return _truncate('\n'.join(lines))

@mcp.tool()
def find_files(pattern: str, path: str = PROJECT_ROOT, max_results: int = 100,
               include_hidden: bool = False, include_backups: bool = False) -> str:
    """按文件名或通配符查找文件/目录，不搜索文件内容。默认跳过依赖、缓存和备份；返回路径、类型、大小。"""
    target = _safe_resolve(path)
    if not target.exists():
        return f"错误: 路径不存在: {target}"
    try:
        matcher = re.compile(fnmatch.translate(pattern), re.IGNORECASE)
    except re.error as e:
        return f"文件名模式错误: {e}"
    max_results = max(1, min(int(max_results), 500))
    skip_dirs = {
        ".git", "node_modules", "__pycache__", ".venv", "venv", "env",
        "site-packages", ".cache", ".pytest_cache", ".mypy_cache", ".ruff_cache",
        ".next", "coverage", "dist", "build"
    }
    def is_backup(name: str) -> bool:
        n = name.casefold()
        return (n.startswith(("backup_", "backup-", "archive_", "recovery_"))
                or n.endswith((".bak", ".old", ".orig", ".swp", "~", ".tar.gz", ".zip"))
                or ".bak-" in n or ".bak." in n)
    found = []
    scanned = 0
    scan_limit = 20000

    def add_entry(p: Path, is_dir: bool):
        try:
            if is_dir:
                found.append(f"[DIR]  {p}/")
            else:
                st = p.stat(follow_symlinks=False)
                found.append(f"[FILE] {p} ({_fmt_size(st.st_size)})")
        except OSError:
            found.append(f"[?] {p}")

    if target.is_file():
        if matcher.fullmatch(target.name):
            add_entry(target, False)
    elif target.is_dir():
        for dirpath, dirnames, filenames in os.walk(target, followlinks=False):
            current = Path(dirpath)
            dirnames[:] = sorted(
                d for d in dirnames
                if (include_hidden or not d.startswith("."))
                and d not in skip_dirs
                and (include_backups or not is_backup(d))
                and not (current / d).is_symlink()
            )
            entries = [(name, True) for name in dirnames] + [(name, False) for name in filenames]
            entries.sort(key=lambda item: (0 if item[1] else 1, item[0].casefold()))
            for name, is_dir in entries:
                if not include_hidden and name.startswith("."):
                    continue
                if not include_backups and is_backup(name):
                    continue
                scanned += 1
                p = current / name
                if p.is_symlink():
                    continue
                if matcher.fullmatch(name):
                    add_entry(p, is_dir)
                    if len(found) >= max_results:
                        break
                if scanned >= scan_limit:
                    break
            if len(found) >= max_results or scanned >= scan_limit:
                break
    else:
        return f"错误: 不支持的路径类型: {target}"

    lines = [f"文件名匹配: {pattern}", f"搜索范围: {target}", f"匹配数量: {len(found)}"]
    lines.extend(found)
    if len(found) >= max_results:
        lines.append(f"…已达到 max_results={max_results} 上限")
    if scanned >= scan_limit:
        lines.append(f"…已扫描 {scan_limit} 项，搜索提前停止；可缩小 path 或使用更具体的 pattern")
    if not found:
        lines.append("没有找到匹配项")
    return _truncate("\\n".join(lines))


@mcp.tool()
def read_file(path: str, start_line: int = 1, end_line: int = 0) -> str:
    """读取文件内容（带行号）。支持 start_line/end_line 分段读取大文件。"""
    p = _safe_resolve(path)
    if not p.is_file():
        return f"错误: 不是文件: {p}"
    size = p.stat().st_size
    if size > MAX_OUTPUT:
        note = f"⚠️ 文件较大（{_fmt_size(size)}），已限制读取量。建议先用 search_text 定位，再用 start_line/end_line 分段读取。\n\n"
    else:
        note = ""
    return note + _read_lines(p, start_line, end_line, MAX_OUTPUT)


# ===================== 看图 / 截图工具 =====================
# [位置:mcp_server.py·screenshot/view_image] [让 AI 直接看到图：无头浏览器截页面（支持日夜两版、先点选择器再截）、读本地图片] [10-27：AI 看不到页面长什么样，只能靠断言猜；MCP 工具可以返回图片，所以补两个；11-13 补 local_storage 预置与随图文字] [注释时间 2026-11-13]
SHOT_WORKER = BASE_DIR / "shot_worker.py"
IMG_EXTS = {".png", ".jpg", ".jpeg", ".gif", ".webp"}
IMG_RAW_LIMIT = 1_200_000   # 超过就先缩成 jpeg 再给，免得一张图吃掉太多上下文


def _run_shot_meta(args: dict, timeout: int):
    # [位置:mcp_server.py·_run_shot_meta] [解析 worker stdout 元数据] [11-13：worker 成功时 stdout 为「OK {json}」，仍以 OK 判定；解析失败静默降级为无文字，兼容旧 worker] [注释时间 2026-11-13]
    out = tempfile.NamedTemporaryFile(prefix="yun_shot_", suffix=".jpg", delete=False)
    out.close()
    args = dict(args, out=out.name)
    try:
        r = subprocess.run([sys.executable, str(SHOT_WORKER), json.dumps(args, ensure_ascii=False)],
                           capture_output=True, text=True, timeout=timeout)
        if r.returncode != 0 or ("OK" not in r.stdout and "FAIL_SHOT" not in r.stdout):
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
            if line.startswith("FAIL_SHOT "):
                try:
                    meta = json.loads(line[10:].strip())
                    meta["failed"] = True
                except Exception:
                    meta = {"failed": True, "error": "步骤失败（附当前现场截图）"}
                break
        return data, meta
    finally:
        try:
            os.unlink(out.name)
        except OSError:
            pass


def _run_shot(args: dict, timeout: int) -> bytes:
    # [位置:mcp_server.py·_run_shot] [view_image 沿用旧出口] [11-13：看图不需要元数据，包装一层避免动它] [注释时间 2026-11-13]
    data, _ = _run_shot_meta(args, timeout)
    return data


@mcp.tool()
def screenshot(url: str = "", page: str = "", theme: str = "", session_id: str = "",
               width: int = 390, height: int = 844, full_page: bool = False, dark: bool = False,
               wait_ms: int = 800, click: list[str] | None = None, selector: str = "", scale: float = 1.0,
               auth: bool = True, unlock: bool = True, local_storage: dict | None = None):
    """用无头浏览器给页面截图并直接返回图片（图前附一行页面信息；操作步骤失败时也会附失败现场图和当前可见元素清单，不再盲猜）。
    截小手机页面时不用背网址和选择器：直接传 page 快捷名即可（url 可留空，默认打开小手机）：
      - page 可选：chat（聊天页）、drawer（极简侧栏抽屉）、avatar（头像菜单）、more（聊天页「…」菜单）、state（状态机页）、state_cfg（状态机配置弹窗）、note（笔记本）、note_set（笔记本设置）、set（设置页）、tools（工具集）、theme（主题页）、mem（记忆池）、wake（唤醒）、cal（月历）、todo（待办）、trace（痕迹）、perm（永久上下文）、star（标星）、lock（锁屏）。
      - theme 可选：day / night / min_day / min_night（自动配好日夜与极简/气泡主题，比手写 local_storage 省事）。
      - session_id 可选：直接定位到指定会话（如 s_xxx）。
    click 支持多步动作（每步自动取首个匹配元素防报错，点击后自动等加载动画结束）：
      - 普通 CSS 选择器（如 "#tkAv"、".cs-it"）
      - 按可见文字点击："text=更多选项"
      - 等待/滚动/直开 App："wait:1000"、"scroll:400"、"scroll:bottom"、"wait_for:.box"、"open:note"
    也可传任意 http(s):// 地址或服务器绝对文件路径（按 file:// 打开）；selector 只截某个元素；full_page 截整页长图；scale 1~2。
    本站页面自动注入登录态（含 han_logged_in）并自动上滑解锁；auth=false 截未登录，unlock=false 截锁屏。"""
    width = max(200, min(int(width), 1600))
    height = max(200, min(int(height), 3000))
    scale = max(1.0, min(float(scale), 2.0))
    u = str(url or "").strip()
    if not u or u.lower() == "phone":
        u = "https://127.0.0.1:9002/phone-new.html"
    elif not re.match(r"^(https?|file)://", u):
        u = _safe_resolve(u).as_uri()
    ls = {str(k): str(v) for k, v in (local_storage or {}).items()} if isinstance(local_storage, dict) else {}
    if len(ls) > 30 or any(len(k) > 200 or len(v) > 8000 for k, v in ls.items()):
        raise ValueError("local_storage 最多 30 个键，键长 ≤200、值长 ≤8000")
    data, meta = _run_shot_meta({
        "mode": "page", "url": u, "page": str(page or "").strip(), "theme": str(theme or "").strip(),
        "session_id": str(session_id or "").strip(),
        "width": width, "height": height, "scale": scale, "dark": bool(dark),
        "wait_ms": max(0, min(int(wait_ms), 15000)), "click": click or [], "selector": selector,
        "full_page": bool(full_page), "auth": bool(auth), "unlock": bool(unlock),
        "local_storage": ls
    }, timeout=60)
    content = []
    if meta.get("failed"):
        content.append(TextContent(type="text", text=str(meta.get("error") or "截图步骤失败（附现场图）")))
        content.append(Image(data=data, format="jpeg"))
        return content
    note = str(meta.get("note") or "")
    if note:
        content.append(TextContent(type="text", text=note))
    content.append(Image(data=data, format="jpeg"))
    return content


def _img_size(p: Path):
    """读图片宽高（png / gif / jpeg / webp，不依赖第三方库）；读不出返回 None。
    [位置:mcp_server.py·_img_size] [view_image 要先知道图多大，才能判断超没超 max_width / max_height] [10-28：截图和看图工具的图片长宽可调，有默认] [注释时间 2026-10-28]"""
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
                    if not b:
                        return None
                    if b != b"\xff":
                        continue
                    m = f.read(1)
                    while m == b"\xff":
                        m = f.read(1)
                    if not m or m in (b"\x01",) or b"\xd0" <= m <= b"\xd9":
                        continue
                    seg = f.read(2)
                    if len(seg) < 2:
                        return None
                    n = struct.unpack(">H", seg)[0]
                    if m[0] in (0xC0, 0xC1, 0xC2, 0xC3, 0xC5, 0xC6, 0xC7, 0xC9, 0xCA, 0xCB, 0xCD, 0xCE, 0xCF):
                        d = f.read(5)
                        h, w = struct.unpack(">HH", d[1:5])
                        return (w, h)
                    f.seek(n - 2, 1)
    except Exception:
        return None
    return None


@mcp.tool()
def view_image(path: str, max_width: int = 1280, max_height: int = 2400) -> Image:
    """读取服务器上的本地图片（png/jpg/gif/webp）并直接返回图片，让 AI 看到。
    max_width / max_height 是返回图片的最大宽 / 高（像素，默认 1280 / 2400）：图片任何一边超过就等比缩小成 jpeg，没超且文件不大就原样返回。
    想看清细节就调大，想省上下文就调小。"""
    p = _safe_resolve(path)
    if not p.is_file():
        raise FileNotFoundError(f"不是文件: {p}")
    if p.suffix.lower() not in IMG_EXTS:
        raise ValueError("只支持 png / jpg / jpeg / gif / webp")
    max_width = max(200, min(int(max_width), 2400))
    max_height = max(200, min(int(max_height), 4000))
    size = _img_size(p)
    over = bool(size) and (size[0] > max_width or size[1] > max_height)
    if p.stat().st_size <= IMG_RAW_LIMIT and not over:
        return Image(path=str(p))
    # 超过任一边（或文件太大）就等比缩小；img 加上两个上限，截 img 元素本身，输出就是缩后的实际大小，没有留白
    html = tempfile.NamedTemporaryFile(prefix="yun_img_", suffix=".html", delete=False, mode="w", encoding="utf-8")
    html.write(f'<body style="margin:0"><img src="{p.as_uri()}" style="display:block;width:auto;height:auto;max-width:{max_width}px;max-height:{max_height}px"></body>')
    html.close()
    try:
        data = _run_shot({"mode": "image", "url": "file://" + html.name, "width": max_width, "height": min(max_height, 1200), "wait_ms": 300,
                          "selector": "img", "quality": 80}, timeout=60)
    finally:
        try:
            os.unlink(html.name)
        except OSError:
            pass
    return Image(data=data, format="jpeg")


@mcp.tool()
def write_file(path: str, content: str, mode: str = "overwrite") -> str:
    """写入或追加文件内容。除受保护的系统目录外均可写。mode: overwrite（覆盖）/ append（追加）/ create（仅新建）"""
    p = _safe_resolve(path, for_write=True)
    if REDACT_MARK in (content or ""):
        return (f"错误: 写入内容里带有脱敏标记（{REDACT_MARK}…），疑似把脱敏后的读取结果写回了文件，"
                "会抹掉真实密钥，已拒绝写入。改含密钥的文件请用 run_command 做局部替换（sed / python），不要整份覆盖。")
    mode = (mode or "overwrite").strip().lower()
    if mode not in {"overwrite", "append", "create"}:
        return "错误: mode 仅支持 overwrite、append、create"
    if p.exists() and p.is_dir():
        return f"错误: 目标是目录，不是文件: {p}"
    try:
        if mode == "append":
            with open(p, "a", encoding="utf-8") as f:
                f.write(content)
        else:
            if mode == "create" and p.exists():
                return f"错误: 文件已存在，如需覆盖请用 overwrite: {p}"
            p.parent.mkdir(parents=True, exist_ok=True)
            p.write_text(content, encoding="utf-8")
    except Exception as e:
        return f"写入失败: {e}"
    return f"✅ 已写入 {p}（{_fmt_size(p.stat().st_size)}）"


@mcp.tool()
def edit_file(path: str, old: str, new: str, replace_all: bool = False) -> str:
    """在已有文件里精确替换文本，改一处不用整份重写。old/new 是精确原文（非正则）：
    old 从 read_file 结果复制时要剥掉行号前缀（形如 "   12 | "），含缩进空格换行；
    须唯一命中：命中多处会报错（多带前后几行让它唯一，或 replace_all=true 全部替换）；
    new 传空串=删除 old。只改文本文件；新建或整份重写用 write_file，模式类复杂改动用 run_command。"""
    # [位置:mcp_server.py·edit_file] [yun 定点替换：old/new 精确替换 + replace_all，改已有文件免整页重写（与 8771 world 工具 edit 同款设计，11-08 拍板）] [注释时间 2026-11-08]
    p = _safe_resolve(path, for_write=True)
    if REDACT_MARK in (new or ""):
        return (f"错误: new 里带有脱敏标记（{REDACT_MARK}…），疑似把脱敏后的读取结果写回文件，"
                "会抹掉真实密钥，已拒绝。改含密钥的文件请用 run_command（sed / python）。")
    if not p.is_file():
        return f"错误: 文件不存在（edit_file 只改已有文件，新建/整写用 write_file）: {p}"
    try:
        text = p.read_text(encoding="utf-8")
    except UnicodeDecodeError:
        return f"错误: {p} 不是 UTF-8 文本，edit_file 处理不了，请用 run_command（sed / python）"
    if "\x00" in text:
        return f"错误: {p} 含二进制字节，不适合文本替换，请用 run_command 处理"
    if not old:
        return "错误: old 必填：要替换的原文（从 read_file 结果复制，剥掉行号前缀）"
    if old == new:
        return "错误: old 和 new 完全相同，没有要改的"
    hits = text.count(old)
    if hits == 0:
        return ("错误: old 在文件里没找到。要与原文一字不差（含缩进空格换行）；"
                "read_file 输出行首的 \"   12 | \" 行号前缀要剥掉，别复制进 old；可先 read_file 再原样复制。")
    if hits > 1 and not replace_all:
        return f"错误: old 命中 {hits} 处：多带前后几行让它唯一再试，或 replace_all=true 全部替换"
    p.write_text(text.replace(old, new) if replace_all else text.replace(old, new, 1), encoding="utf-8")
    n = hits if replace_all else 1
    return f"✅ 已编辑 {p}（替换 {n} 处，{_fmt_size(p.stat().st_size)}）"


# 内容行时间戳识别与区间过滤（search_text 可选时间参数用）
_TS_RE = re.compile(r"(\d{4}[-/]\d{2}[-/]\d{2})[ T](\d{2}:\d{2}(?::\d{2})?)")


def _parse_time_bound(s: str):
    """解析绝对时间字符串，支持 2026-08-01 或 2026-08-01 10:00:00。"""
    s = (s or "").strip().strip('"\'')
    if not s:
        return None
    for fmt in ("%Y-%m-%d %H:%M:%S", "%Y-%m-%d %H:%M", "%Y-%m-%d",
                "%Y/%m/%d %H:%M:%S", "%Y/%m/%d %H:%M", "%Y/%m/%d"):
        try:
            return datetime.strptime(s, fmt)
        except ValueError:
            continue
    return None


def _line_in_time_range(line: str, time_start, time_end) -> bool:
    """行内容里出现的时间戳是否落在 [time_start, time_end]（任一为空表示不限）。"""
    if time_start is None and time_end is None:
        return True
    m = _TS_RE.search(line)
    if not m:
        return False
    hms = m.group(2) if len(m.group(2)) == 8 else m.group(2) + ":00"
    try:
        ts = datetime.strptime(m.group(1).replace("/", "-") + " " + hms, "%Y-%m-%d %H:%M:%S")
    except ValueError:
        return False
    if time_start is not None and ts < time_start:
        return False
    if time_end is not None and ts > time_end:
        return False
    return True


# 搜索屏蔽名单（2026-11-05；11-11 加 _archive；11-14 产品确定扩全）：search_text 目录搜索不扫的目录，
# 按 os.walk 任意层级目录名匹配（原语义不变）。11-14 扩全：data、node_modules、__pycache__、.git 等
# 依赖/缓存/构建目录，备份/归档/archives/backup 等备份归档目录一并圈进来——全是生成物或历史版本，
# 会把全文搜索带偏；find_files 按文件名找文件不受此名单影响（它有自己的 skip_dirs），屏蔽只管 search_text。
# 特指单个文件（path 直接指向该文件）仍可读/搜。
SEARCH_SKIP_DIRS = (
    "timeline_data", "timeline_guard", "_archive",
    "data", "node_modules", "__pycache__", ".git",
    ".venv", "venv", "env", "dist", "build", ".cache", ".next", ".idea", ".vscode",
    "备份", "归档", "archives", "archive", "backup", "backups",
)
SEARCH_SKIP_FILE_PATTERNS = ("enhanced_messages*.json*",)


def _is_backup_file_name(name: str) -> bool:
    """备份类文件名：文件名任意位置含 bak（*.bak、*.bak-xxx、_bak_ 等变体），
    或 .old/.orig/.swp/~ 结尾，目录搜索时跳过（2026-11-10；11-11 由「.bak 系列」放宽为任意位置含 bak）。"""
    n = name.casefold()
    return "bak" in n or n.endswith((".old", ".orig", ".swp", "~"))


@mcp.tool()
def search_text(pattern: str, path: str = PROJECT_ROOT, file_filter: str = "*", max_results: int = 100,
                start_time: str = "", end_time: str = "") -> str:
    """在目录或单个文件中搜索文本（支持正则），返回 文件:行号:内容。目录模式自动跳过 SEARCH_SKIP_DIRS 名单里的目录（数据/依赖/缓存/构建/备份归档类，含 data、node_modules、备份、归档、archives 等，任意层级匹配目录名），也跳过会话时间线（timeline_data、timeline_guard、enhanced_messages*.json）和备份类文件（文件名任意位置含 bak，或 .old/.orig/.swp/~ 结尾）；特指单个文件仍可读/搜。
    start_time/end_time 为可选绝对时间（如 2026-08-01 或 2026-08-01 10:00:00），传入后仅返回内容行时间戳落在区间内的匹配。"""
    target = _safe_resolve(path)
    try:
        regex = re.compile(pattern)
    except re.error as e:
        return f"正则表达式错误: {e}"
    max_results = max(1, min(int(max_results), 500))
    time_start = _parse_time_bound(start_time) if start_time else None
    time_end = _parse_time_bound(end_time) if end_time else None
    if start_time and time_start is None:
        return f"时间格式无法解析: {start_time!r}（支持 2026-08-01 或 2026-08-01 10:00:00）"
    if end_time and time_end is None:
        return f"时间格式无法解析: {end_time!r}（支持 2026-08-01 或 2026-08-01 10:00:00）"
    time_filter_on = time_start is not None or time_end is not None
    matches = []

    def scan_file(fp: Path) -> None:
        if len(matches) >= max_results:
            return
        # 不读取符号链接文件，避免搜索范围意外越过指定目录。
        if fp.is_symlink() or not fp.is_file() or _is_denied_read(fp):
            return
        try:
            if os.path.getsize(fp) > 2 * 1024 * 1024:
                return
            with open(fp, "r", encoding="utf-8", errors="ignore") as f:
                for lineno, line in enumerate(f, 1):
                    if regex.search(line) and _line_in_time_range(line, time_start, time_end):
                        matches.append(f"{fp}:{lineno}: {_redact(line.rstrip())[:200]}")
                        if len(matches) >= max_results:
                            return
        except (OSError, UnicodeDecodeError):
            return

    if target.is_file():
        kind = "文件"
        scan_file(target)
    elif target.is_dir():
        kind = "目录"
        skip_dirs = set(SEARCH_SKIP_DIRS)
        for dirpath, dirnames, filenames in os.walk(target):
            dirnames[:] = sorted(d for d in dirnames if d not in skip_dirs)
            for name in sorted(filenames):
                if not fnmatch.fnmatch(name, file_filter):
                    continue
                if any(fnmatch.fnmatch(name, pat) for pat in SEARCH_SKIP_FILE_PATTERNS):  # 会话时间线不进目录搜索（2026-11-05）
                    continue
                if _is_backup_file_name(name):  # 备份文件不进目录搜索（2026-11-10）
                    continue
                scan_file(Path(dirpath) / name)
                if len(matches) >= max_results:
                    break
            if len(matches) >= max_results:
                break
    else:
        return f"错误: 路径不存在: {target}"
    time_note = ""
    if time_filter_on:
        time_note = f"（时间过滤: {start_time or '不限'} ~ {end_time or '不限'}）"
    head = f"🔍 在{kind} {target} 找到 {len(matches)} 处匹配" + ("（已达上限）" if len(matches) >= max_results else "") + time_note + chr(10)
    return _truncate(head + chr(10).join(matches))


@mcp.tool()
def file_info(path: str) -> str:
    """查看文件/目录信息：类型、大小、修改时间、权限。"""
    try:
        p = _safe_resolve(path)
        st = p.stat()
    except FileNotFoundError:
        return f"错误: 路径不存在: {path}"
    except PermissionError as e:
        return f"错误: 无权访问路径: {path}（{e}）"
    except OSError as e:
        return f"读取路径信息失败: {path}（{e}）"
    kind = "📁 目录" if p.is_dir() else "📄 文件"
    return (
        f"路径: {p}\n"
        f"类型: {kind}\n"
        f"大小: {_fmt_size(st.st_size)}\n"
        f"修改时间: {time.strftime('%Y-%m-%d %H:%M:%S', time.localtime(st.st_mtime))}\n"
        f"权限: {stat.filemode(st.st_mode)}"
    )


# ===================== 文件占用登记（claim） =====================

# 与网关 lib/claim-locks.js 共用同一份数据（data/claim-locks.json + claim-alerts.json）。
# [位置:mcp_server.py·claim_lock] [文件占用登记工具] [10-31：各平台 agent / 子智能体没有会话 id，
#   用工具（而非聊天侧 <claim> 标签）登记要改的文件；同一个库，按文件名互相撞冲突；
#   撞车写同一份告警文件（前端横幅轮询弹出），WebPush 由网关侧发、这里不碰] [注释时间 2026-10-31]
CLAIM_LOCK_FILE = BASE_DIR.parent / "data" / "claim-locks.json"
CLAIM_ALERT_FILE = BASE_DIR.parent / "data" / "claim-alerts.json"
_CLAIM_ACT_RE = re.compile(r"^(增|加|新增|新加|写入|写|改|编辑|修改|更新|删|删除|移除|add|create|write|edit|modify|update|del|delete|remove)$", re.I)


def _claim_norm_action(a: str) -> str:
    a = (a or "").lower()
    if re.match(r"^(增|加|新增|新加|add|create)", a):
        return "增"
    if re.match(r"^(写入|写|write)", a):
        return "写"
    if re.match(r"^(删|删除|移除|del|delete|remove)", a):
        return "删"
    return "改"


CLAIM_EXPIRE_MS = 3 * 3600 * 1000   # 占用登记超 3h 自动清（10-31 拍板自动过期；11-07 改 24h→3h，与网关 lib/claim-locks.js 同步）


def _claim_prune() -> int:
    """过期清理：ts 距今 >24h 的登记删掉；list/add/clear 入口先跑，任何一侧进来都先清旧的。"""
    db = _claim_read(CLAIM_LOCK_FILE, {})
    now = int(time.time() * 1000)
    stale = [k for k, v in db.items() if isinstance(v, dict) and v.get("ts") and now - v["ts"] > CLAIM_EXPIRE_MS]
    if stale:
        for k in stale:
            del db[k]
        _claim_write(CLAIM_LOCK_FILE, db)
    return len(stale)


def _claim_read(file: Path, fallback):
    try:
        j = json.loads(file.read_text(encoding="utf-8"))
        return j if isinstance(j, dict) else fallback
    except Exception:
        return fallback


def _claim_write(file: Path, obj) -> None:
    file.parent.mkdir(parents=True, exist_ok=True)
    tmp = file.with_name(file.name + f".tmp-{os.getpid()}-{int(time.time() * 1000)}")
    tmp.write_text(json.dumps(obj, ensure_ascii=False, indent=2), encoding="utf-8")
    os.replace(tmp, file)


def _claim_parse_files(raw: str) -> list:
    out, seen = [], set()
    for seg in re.split(r"[、,，;；\n]+", raw or ""):
        last_act = ""
        for tok0 in seg.strip().split():
            tok = tok0.strip("[](){}<>「」『」"'"'"’‘.。")
            if not tok:
                continue
            m = re.match(r"^(\S+?)[:：=](\S+)$", tok)
            if m and not _CLAIM_ACT_RE.match(m.group(1)):
                fp = m.group(1)
                if fp and not re.search(r"[<>\"']", fp):
                    k = fp.lower()
                    if k not in seen:
                        seen.add(k)
                        out.append({"path": fp[:120], "action": _claim_norm_action(m.group(2))})
                continue
            if _CLAIM_ACT_RE.match(tok):
                last_act = _claim_norm_action(tok)
                continue
            fp = tok
            if fp and not re.search(r"[<>\"']", fp):
                k = fp.lower()
                if k not in seen:
                    seen.add(k)
                    out.append({"path": fp[:120], "action": last_act or "改"})
    return out[:30]


def _claim_ago(ts_ms) -> str:
    d = int(time.time() * 1000) - int(ts_ms or 0)
    if d < 60000:
        return "刚刚"
    if d < 3600000:
        return f"{d // 60000} 分钟前"
    if d < 86400000:
        return f"{d // 3600000} 小时前"
    return f"{d // 86400000} 天前"


def _claim_push_alert(sid: str, name: str, conflicts: list) -> None:
    db = _claim_read(CLAIM_ALERT_FILE, {"list": []})
    lst = db.get("list") if isinstance(db.get("list"), list) else []
    lst.insert(0, {
        "id": "ca_" + format(int(time.time() * 1000), "x") + os.urandom(2).hex(),
        "ts": int(time.time() * 1000),
        "sid": sid,
        "name": (name or "")[:30],
        "read": False,
        "conflicts": [
            {"file": c["file"], "action": c["action"], "other_name": c["other_name"], "other_action": c["other_action"]}
            for c in conflicts[:8]
        ],
    })
    db["list"] = lst[:20]
    _claim_write(CLAIM_ALERT_FILE, db)


@mcp.tool()
def claim_lock(action: str, files: str = "", name: str = "", target: str = "", session_id: str = "") -> str:
    """文件占用登记（多 agent 并行改代码防撞车）。开工改代码前 add 占坑，完成 clear 退坑，list 看谁占着什么。
    - action="add"：files=要改的文件（只写文件名，顿号/逗号/空格分隔，如 "server.js、lib/album.js"）；name=本次任务名（建议传，冲突横幅和 list 里好认；不传自动生成）。
      返回里若报冲突=别的会话已登记同一个文件：先让用户裁决暂停谁，别急着改这些文件。
      session_id 网关会自动注入（聊天会话调用时落到本会话键，小手机浮球算「自己的」、清除按钮能退），不用自己传；
      第三方应用直连工具集没这一层，不传落 tool_ 键（浮球标「工具」）。
    - action="list"：列出当前全部占用（谁、哪些文件、几点登记的）。
    - action="clear"：退坑。target=登记 id（tool_ 开头）或任务名；聊天会话退自己的坑可以不带 target（网关注入的 session_id 兜底）；target="all" 清全部（慎用，会把聊天会话的登记也清掉）。
    与聊天侧 <claim> 标签共用一个库：聊天会话的登记 id 是 s_ 开头。"""
    action = (action or "").strip().lower()
    if action == "list":
        pruned = _claim_prune()
        db = _claim_read(CLAIM_LOCK_FILE, {})
        if not db:
            return f"当前没有任何占用登记" + (f"（已自动清 {pruned} 条超过 3 小时的）。" if pruned else "。")
        lines = []
        for sid, rec in sorted(db.items(), key=lambda kv: kv[1].get("ts", 0) if isinstance(kv[1], dict) else 0):
            if not isinstance(rec, dict):
                continue
            fl = "、".join(x.get("path") for x in rec.get("files", []) if isinstance(x, dict))
            lines.append(f"[{sid}] {fl}（{_claim_ago(rec.get('ts'))}）")   # [10-31二次拍板] 更新时间用「13分钟前」时长，比钟点直观、省 AI 判断陈旧度
        note = f"已自动清 {pruned} 条超过 3 小时的，" if pruned else ""   # 清理提示跟着首行走，空库分支同款语义
        return f"当前占用 {len(lines)} 条（{note}做完记得 clear 退坑）：\n" + "\n".join(lines)
    if action == "add":
        _claim_prune()
        items = _claim_parse_files(files)
        if not items:
            return "错误: files 没解析出文件名。只写文件名即可，顿号/逗号/空格分隔，例：files=\"server.js、lib/album.js\""
        db = _claim_read(CLAIM_LOCK_FILE, {})
        insid = (session_id or "").strip()[:64]
        if insid:
            # [位置:mcp_server.py·claim_lock add 会话键] [网关注入 session_id 落本会话键] [11-07：聊天会话的 AI 用工具登记也落到 s_ 键，浮球算本会话、清除按钮能退坑；name 缺省读 session-names.json 的会话名，跟网关侧 <claim> 标签（lib/claim-locks.js claim）同一口径] [注释时间 2026-11-07]
            sid = insid
            nm = (name or "").strip()[:30]
            if not nm:
                _names = _claim_read(BASE_DIR.parent / "data" / "session-names.json", {})
                nm = str(_names.get(sid) or "").strip()[:30]
            if not nm:
                nm = f"tool-{datetime.now().strftime('%H%M%S')}"
        else:
            sid = "tool_" + format(int(time.time() * 1000), "x") + os.urandom(2).hex()
            nm = (name or "").strip()[:30] or f"tool-{datetime.now().strftime('%H%M%S')}"
        db[sid] = {"name": nm, "files": items, "ts": int(time.time() * 1000)}
        _claim_write(CLAIM_LOCK_FILE, db)
        conflicts, seen = [], set()
        for osid, rec in db.items():
            if osid == sid or not isinstance(rec, dict):
                continue
            for of in rec.get("files", []):
                if not isinstance(of, dict):
                    continue
                for mf in items:
                    if of.get("path", "").rsplit("/", 1)[-1].lower() != mf["path"].rsplit("/", 1)[-1].lower():
                        continue
                    key = mf["path"] + "|" + osid
                    if key in seen:
                        continue
                    seen.add(key)
                    conflicts.append({"file": mf["path"], "action": mf["action"], "other_name": rec.get("name") or osid, "other_action": of.get("action")})
        if conflicts:
            _claim_push_alert(sid, nm, conflicts)
            det = "\n".join(f"  - {c['file']}（{c['action']}）跟「{c['other_name']}」撞了（它要 {c['other_action']}）" for c in conflicts)
            return f"已登记 {len(items)} 个文件（id={sid}，名字={nm}），但有 {len(conflicts)} 处冲突：\n{det}\n先让用户裁决暂停谁，别急着改这些文件。"
        fl = "、".join(x["path"] for x in items)
        tip = "聊天页浮球算本会话，退坑 claim_lock(action=\"clear\") 即可（不带 target 也行）" if insid else f"任务完成记得 claim_lock(action=\"clear\", target=\"{sid}\") 退坑"
        return f"已登记 {len(items)} 个文件（id={sid}，名字={nm}）：{fl}\n无冲突。{tip}。"
    if action == "clear":
        _claim_prune()
        db = _claim_read(CLAIM_LOCK_FILE, {})
        if not db:
            return "当前没有占用登记。"
        t = (target or "").strip()
        if not t:
            t = (session_id or "").strip()[:64]   # 聊天会话退自己的坑：不带 target 时用网关注入的 session_id 兜底
        if not t:
            return "错误: clear 需要 target=登记 id 或任务名（list 里看）；target=\"all\" 清全部。"
        if t.lower() == "all":
            n = len(db)
            _claim_write(CLAIM_LOCK_FILE, {})
            return f"已清掉全部 {n} 条占用登记（含聊天会话的 <claim>，如有）。"
        hit = [k for k in db if k == t or (isinstance(db[k], dict) and db[k].get("name") == t)]
        if not hit:
            return f"错误: 没找到 id 或名字为「{t}」的登记（先 list 看一下）。"
        for k in hit:
            del db[k]
        _claim_write(CLAIM_LOCK_FILE, db)
        return f"已清 {len(hit)} 条（{('、'.join(hit))[:80]}），剩 {len(db)} 条。"
    return "错误: action 仅支持 list / add / clear"


# ===================== 执行与状态工具 =====================


@mcp.tool()
def run_command(command: str, cwd: str = "", timeout: int = 30) -> str:
    """在服务器上执行 shell 命令（本地直接执行）。可用 cwd 指定工作目录、timeout 调整超时（最长 300 秒）。"""
    timeout = min(max(int(timeout), 1), 300)
    for _root in DENY_READ_ROOTS:
        if str(_root) in (command or ""):
            return (f"错误: 命令引用了受保护路径（含密钥）: {_root}。新增/轮换 MCP 密钥请用 "
                    "scripts/migrate_mcp_secrets.py，或让用户自己在终端处理。")
    workdir = None
    if cwd:
        workdir = _safe_resolve(cwd)
        if not workdir.is_dir():
            return f"错误: 工作目录不存在: {workdir}"
    try:
        proc = subprocess.run(
            command, shell=True, cwd=workdir,
            capture_output=True, text=True, timeout=timeout,
            encoding="utf-8", errors="replace",
        )
    except subprocess.TimeoutExpired:
        return f"⏱️ 命令超时（>{timeout} 秒）已终止。建议缩小操作范围或调大 timeout。"
    except Exception as e:
        return f"执行出错: {e}"
    stdout = _redact(proc.stdout or "")
    stderr = _redact(proc.stderr or "")
    sections = []
    if stdout.strip():
        sections.append("[stdout]\\n" + stdout.rstrip())
    if stderr.strip():
        sections.append("[stderr]\\n" + stderr.rstrip())
    if not sections:
        sections.append("(命令未产生输出)")
    result = _truncate("\\n\\n".join(sections))
    result += f"\\n\\n退出码: {proc.returncode}"
    return result


@mcp.tool()
def get_server_status() -> str:
    """查看服务器 CPU、内存、磁盘状态。"""
    return run_command("echo '=== CPU 负载 ===' && uptime && echo '=== 内存 ===' && free -h && echo '=== 磁盘 ===' && df -h /")


# ===================== git 只读工具 =====================


def _git_run(path: str, args: list) -> str:
    p = _safe_resolve(path)
    if not p.exists():
        return f"错误: 路径不存在: {p}"
    # 传单文件时定位到所在目录（git -C 会向上找仓库根），并把 diff/status/log 聚焦到该文件
    file_part = None
    if p.is_file():
        file_part = p.name
        p = p.parent
    try:
        proc = subprocess.run(
            ["git", "-C", str(p), *args] + (["--", file_part] if file_part else []),
            capture_output=True, text=True, timeout=20,
            encoding="utf-8", errors="replace",
        )
    except subprocess.TimeoutExpired:
        return "⏱️ git 操作超时"
    except Exception as e:
        return f"git 执行出错: {e}"
    out = proc.stdout or ""
    if proc.stderr:
        out += "\n[stderr]\n" + proc.stderr
    return _truncate(_redact(out))


@mcp.tool()
def git_status(path: str) -> str:
    """查看项目的 git 状态：当前分支、已修改/未跟踪文件（只读）。path 传项目目录或单文件（传文件时只显示该文件的状态）。"""
    return _git_run(path, ["status", "--short", "--branch"])


@mcp.tool()
def git_log(path: str, count: int = 10) -> str:
    """查看最近提交记录（只读）。count 为条数。path 传项目目录或单文件（传文件时只显示该文件的提交历史）。"""
    count = max(1, min(int(count), 100))
    return _git_run(path, ["log", "--oneline", "-n", str(count)])


@mcp.tool()
def git_diff(path: str, staged: bool = False) -> str:
    """查看工作区改动内容（只读）。staged=True 时查看已暂存（git add 过）的改动。path 传项目目录（整个仓库的改动）或单文件（只看该文件的改动）。"""
    args = ["diff"] + (["--cached"] if staged else [])
    return _git_run(path, args)


# ===================== 子智能体（2026-10-27 从 8771「工具集合」搬到云服务器） =====================
# 说明：8771 那台只放「小手机/记忆类」工具，干活的子智能体归云服务器这一套；引擎仍在网关 lib/subagent-runner.js，
# 这里只做转调（/internal/subagent/*，鉴权 x-internal-key）。本服务 systemd 没配 EnvironmentFile，密钥自己读 .env。
# 2026-11-14 随手记 #24：run 加可选 model 参数（主会话指定本次模型，网关校验启用列表）；新增 models 工具查启用清单。
GATEWAY_BASE = "http://127.0.0.1:3000"
ENV_FILE = Path(os.path.join(PROJECT_ROOT, ".env"))


def _load_internal_key() -> str:
    """网关内部密钥：先环境变量，再项目 .env（yun-mcp-v2 的 unit 没配 EnvironmentFile）。"""
    k = os.environ.get("INTERNAL_API_KEY", "").strip()
    if k:
        return k
    try:
        with open(ENV_FILE, "r", encoding="utf-8") as f:
            for line in f:
                line = line.strip()
                if line.startswith("INTERNAL_API_KEY="):
                    return line.split("=", 1)[1].strip().strip('"').strip("'")
    except Exception:
        pass
    return ""


def _gateway_call(method: str, path: str, params=None, body=None, timeout: int = 15) -> dict:
    key = _load_internal_key()
    if not key:
        return {"ok": False, "error": "网关内部密钥缺失（INTERNAL_API_KEY 在环境变量和项目 .env 里都没找到）"}
    headers = {"x-internal-key": key}
    url = GATEWAY_BASE + path
    # trust_env 是 Session 的属性，不是 request() 的参数（传进去会 TypeError）；这里显式关掉代理环境变量
    sess = requests.Session()
    sess.trust_env = False
    try:
        if method == "GET":
            r = sess.get(url, params=params, headers=headers, timeout=timeout)
        else:
            r = sess.post(url, json=(body or {}), headers=headers, timeout=timeout)
    except Exception as e:
        return {"ok": False, "error": "调网关失败：%s" % e}
    try:
        return r.json()
    except Exception:
        return {"ok": False, "error": "网关返回非 JSON（HTTP %s）：%s" % (r.status_code, (r.text or "")[:300])}


@mcp.tool()
def subagent(action: str, task: str = "", subagent_id: str = "", tag: str = "",
             start_line: int = 0, end_line: int = 0, preset: str = "", model: str = "") -> str:
    """subagent：派子智能体干杂活（用「新建会话预设」开的独立会话，人设、模型、工具都在预设里配，默认用名叫「子会话」的预设；不占你的上下文）。action=run（派活，立刻返回任务 id，不等待）：task 必填（任务提示词：写清楚要干什么，并在 task 里交代不可重启网关；不用指定报告标签，子会话会把报告写在 <report_01>…</report_01> 里，第几次任务就是第几号）；subagent_id 可选（传=续用那个子会话，在它里面追加这条提示词，不传=新建）；preset 可选（新建时用哪个预设，填预设名字，缺省「子会话」）。model 可选（本次任务指定用哪个模型：先调 models 工具查启用列表，填查到的模型名；传了就只用它，失败不换预设里的备用模型，跑完还原；不在启用列表会直接报错不派活；续用旧会话时同样生效）。子智能体模型较慢，派完不用原地等：用 wake 工具（或 <wake> 标签）给自己定个几分钟后的唤醒，到点再回来 report 查报告；不设也行，过一会儿自己查。action=report（取报告）：subagent_id 必填；tag 可选（不填=取最新一份 report_NN 报告，也可填 report_02 这样指定某一次，不带尖括号）；没找到=还未完成，中断会提示。action=log（看过程记录）：subagent_id 和 start_line 必填（起始记录序号，从 1 起，写入时自带序号）；end_line 可选（缺省=start_line+39）。记录内容：AI 正文全文与每次工具调用（名+完整参数，出错附错误信息），不含工具结果与思考；长内容自动按约 1800 字切块，块首标注（第x/y块，第a-b字，共N字），按行号取块即可拼出全文或精确跳段。不可自行重启网关——你和子智能体都禁止执行重启网关的命令；派活时在 task 里交代这条，需要重启时在报告里说明，由用户决定。字段归属：task/subagent_id/preset/model→run；subagent_id/tag→report；subagent_id/start_line/end_line→log。

    Args:
        action: run=派活；report=取报告；log=看过程记录
        task: run：任务提示词。写清楚要干什么，并交代不可重启网关（不用指定报告标签，子会话统一写 <report_NN>）
        subagent_id: 子智能体会话 id（run 复用时=要续用的那个；report/log=目标）
        preset: run 新建时用哪个新建会话预设（填预设名字，缺省「子会话」）；续用已有会话时忽略
        model: run：可选。指定本次任务用的模型（先用 models 工具查启用列表再填）；不传=用预设配的模型组
        tag: report：可选。报告标签名（不带尖括号，如 report_02）；不填=取最新一份 report_NN
        start_line: log：起始记录序号（必填，从 1 起）
        end_line: log：结束记录序号（可选，缺省=start_line+39）
    """
    act = str(action or "").strip()
    sid = str(subagent_id or "").strip()
    if act == "run":
        t = str(task or "").strip()
        if not t:
            return json.dumps({"ok": False, "error": "缺少 task（任务提示词）"}, ensure_ascii=False)
        body = {"task": t, "parent_session": ""}
        if sid:
            body["session_id"] = sid
        if str(preset or "").strip():
            body["preset"] = str(preset).strip()
        if str(model or "").strip():
            body["model"] = str(model).strip()   # 11-14 随手记 #24：主会话指定本次模型，网关校验启用列表，不在就报错
        return json.dumps(_gateway_call("POST", "/internal/subagent/start", body=body, timeout=60), ensure_ascii=False)
    if act == "report":
        return json.dumps(_gateway_call("GET", "/internal/subagent/report",
                                       params={"session_id": sid, "tag": str(tag or "").strip()},
                                       timeout=15), ensure_ascii=False)
    if act == "log":
        params = {"session_id": sid, "start_line": int(start_line or 0)}
        if int(end_line or 0) > 0:
            params["end_line"] = int(end_line)
        return json.dumps(_gateway_call("GET", "/internal/subagent/log", params=params, timeout=15), ensure_ascii=False)
    return json.dumps({"ok": False, "error": "action 只支持 run / report / log"}, ensure_ascii=False)


# models：启用中的模型清单（随手记 #24，2026-11-14）——subagent 派活选 model 参数用，转调网关 /internal/models
@mcp.tool()
def models() -> str:
    """查看网关当前启用的 AI 模型清单（给 subagent 派活选 model 用）。返回 providers：按供应商分组的 {id, name, is_default, models:[模型名]}，只列「启用且有凭据」的供应商（与设置页模型下拉同一口径）；subagent 派活时把 models 里的名字填进 model 参数即可。"""
    return json.dumps(_gateway_call("GET", "/internal/models", timeout=15), ensure_ascii=False)


# ===================== 鉴权与 CORS 中间件 =====================


def _cors_headers(scope) -> list:
    """按请求 Origin 回 CORS 头（无 Origin 则 *），供浏览器类 agent 直连。"""
    origin = None
    for raw_k, raw_v in scope.get("headers", []):
        if raw_k.decode().lower() == "origin":
            origin = raw_v.decode()
            break
    return [
        (b"access-control-allow-origin", (origin or "*").encode()),
        (b"access-control-allow-methods", b"GET, POST, DELETE, OPTIONS"),
        (b"access-control-allow-headers",
         b"content-type, accept, x-api-key, authorization, mcp-session-id, last-event-id"),
        (b"access-control-expose-headers", b"mcp-session-id"),
        (b"access-control-max-age", b"86400"),
        (b"vary", b"Origin"),
    ]


class AuthMiddleware:
    """最外层中间件：CORS 预检放行 + 业务路径统一鉴权 + 响应补 CORS 头。

    鉴权任选其一：X-API-Key 头 / Authorization: Bearer / Cookie X-API-Key / URL 参数 X-API-Key；
    带 mcp-session-id 头的请求视为 initialize 时已通过鉴权建立的会话，直接放行。
    """

    def __init__(self, app):
        self.app = app

    @staticmethod
    def _extract_key(scope):
        headers = dict(scope.get("headers", []))
        for raw_k, raw_v in headers.items():
            k = raw_k.decode().lower()
            if k == "x-api-key":
                return raw_v.decode()
            if k == "authorization":
                v = raw_v.decode().strip()
                return v[7:].strip() if v.lower().startswith("bearer ") else v
        cookie_header = headers.get(b"cookie", b"").decode()
        for pair in cookie_header.split(";"):
            if "=" in pair:
                ck, cv = pair.split("=", 1)
                if ck.strip() == "X-API-Key":
                    return cv.strip()
        params = parse_qs(scope.get("query_string", b"").decode())
        return (params.get("X-API-Key") or [None])[0]

    def _authorized(self, scope) -> bool:
        headers = dict(scope.get("headers", []))
        if any(k.decode().lower() == "mcp-session-id" and v for k, v in headers.items()):
            return True
        key = self._extract_key(scope)
        if not isinstance(key, str):
            return False
        try:
            return hmac.compare_digest(key, API_KEY)
        except TypeError:
            return False

    async def __call__(self, scope, receive, send):
        if scope["type"] != "http":
            await self.app(scope, receive, send)
            return

        path = scope.get("path", "")
        method = scope.get("method", "")

        # CORS 预检不带凭据，直接放行
        if method == "OPTIONS":
            headers = _cors_headers(scope) + [(b"content-length", b"0")]
            await send({"type": "http.response.start", "status": 204, "headers": headers})
            await send({"type": "http.response.body", "body": b""})
            return

        # 除 /health 外所有路径都要鉴权（堵住此前 POST /sse 匿名直进的洞）
        if path != "/health" and not self._authorized(scope):
            body = b'{"error":"Unauthorized"}'
            headers = [
                (b"content-type", b"application/json"),
                (b"content-length", str(len(body)).encode()),
            ] + _cors_headers(scope)
            await send({"type": "http.response.start", "status": 401, "headers": headers})
            await send({"type": "http.response.body", "body": body})
            return

        async def send_with_cors(event):
            if event["type"] == "http.response.start":
                event = dict(event)
                event["headers"] = list(event.get("headers", [])) + _cors_headers(scope)
            await send(event)

        await self.app(scope, receive, send_with_cors)


# ===================== 路由与启动 =====================

if __name__ == "__main__":
    # streamable-http：标准路径 /mcp
    http_app = mcp.http_app(path="/mcp", transport="streamable-http")
    # 传统 SSE（2024-11-05 协议客户端用）：GET /sse 建立事件流，POST /messages/ 收消息（/legacy-sse 为兼容别名）
    sse_app = create_sse_app(mcp, sse_path="/sse", message_path="/messages/")

    class RouterApp:
        def __init__(self, http_app, sse_app):
            self.http_app = http_app
            self.sse_app = sse_app

        async def __call__(self, scope, receive, send):
            if scope["type"] != "http":
                return
            path = scope.get("path", "")
            if path == "/mcp":
                await self.http_app(scope, receive, send)
            elif path in ("/sse", "/legacy-sse") or path.startswith("/messages/"):
                if path == "/legacy-sse":
                    scope = dict(scope)
                    scope["path"] = "/sse"
                await self.sse_app(scope, receive, send)
            elif path == "/health":
                body = b'{"status":"ok"}'
                await send({
                    "type": "http.response.start", "status": 200,
                    "headers": [(b"content-type", b"application/json"), (b"content-length", str(len(body)).encode())],
                })
                await send({"type": "http.response.body", "body": body})
            else:
                body = b'{"error":"Not Found"}'
                await send({
                    "type": "http.response.start", "status": 404,
                    "headers": [(b"content-type", b"application/json")],
                })
                await send({"type": "http.response.body", "body": body})

    class LifespanApp:
        """合并两个子应用的 lifespan（各拉起各的会话管理器），请求全部转给 router。"""

        def __init__(self, router):
            self.router = router
            self._stack = None

        async def __call__(self, scope, receive, send):
            if scope["type"] == "lifespan":
                await self._lifespan(receive, send)
                return
            await self.router(scope, receive, send)

        async def _lifespan(self, receive, send):
            while True:
                message = await receive()
                if message["type"] == "lifespan.startup":
                    break
            try:
                stack = contextlib.AsyncExitStack()
                await stack.enter_async_context(http_app.lifespan(http_app))
                await stack.enter_async_context(sse_app.lifespan(sse_app))
                self._stack = stack
                await send({"type": "lifespan.startup.complete"})
            except Exception as e:
                await send({"type": "lifespan.startup.failed", "message": str(e)})
                return
            while True:
                message = await receive()
                if message["type"] == "lifespan.shutdown":
                    break
            try:
                await self._stack.aclose()
                await send({"type": "lifespan.shutdown.complete"})
            except Exception as e:
                await send({"type": "lifespan.shutdown.failed", "message": str(e)})

    router = RouterApp(http_app, sse_app)
    app = AuthMiddleware(LifespanApp(router))

    uvicorn.run(app, host=(os.environ.get("LISTEN_HOST", "127.0.0.1").strip() or "127.0.0.1"), port=int(os.environ.get("YUN_MCP_PORT", "9010")), log_level="info")
