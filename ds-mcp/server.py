#!/usr/bin/env python3
"""
DeepSeek 搜索 MCP 服务（ds_search / ds_fetch）

端口: 127.0.0.1:8772 · 路径: /mcp · 鉴权: Bearer Token
协议: MCP Streamable HTTP（mcp SDK 1.28.1 自带 FastMCP）
密钥: 运行时从 ${PROJECT_ROOT}/config/ai-providers.json 读取，本服务不保存密钥副本。
      name 为 deepseek 或 api_url 指向 api.deepseek.com 的 provider 即视为目标。
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
import os
import sys
import time
import urllib.error
import urllib.request
from typing import Annotated, Optional

import uvicorn
from mcp.server.fastmcp import FastMCP
from pydantic import Field

HOST = "127.0.0.1"
PORT = 8772
API_BASE = "https://api.deepseek.com/v1/tools"
PROVIDERS_FILE = os.path.join(PROJECT_ROOT, "config/ai-providers.json")
SEARCH_TIMEOUT = 60
FETCH_TIMEOUT = 90

TOKEN = (os.environ.get("MCP_TOOLS_API_TOKEN") or "").strip()

mcp = FastMCP(
    "ds-mcp",
    host=HOST,
    port=PORT,
    streamable_http_path="/mcp",
    stateless_http=False,
    log_level="INFO",
)

# ===== 密钥读取（实时读配置 + 进程内缓存兜底）=====
_key_cache = {"key": None, "ts": 0.0}
KEY_CACHE_TTL = 60.0


def log(msg: str) -> None:
    print(f"[{time.strftime('%Y-%m-%d %H:%M:%S')}] {msg}", flush=True)


def get_api_key() -> str:
    """从 ai-providers.json 读取官方 DeepSeek key；读失败时回退到上次成功值。"""
    now = time.time()
    if _key_cache["key"] and now - _key_cache["ts"] < KEY_CACHE_TTL:
        return _key_cache["key"]
    try:
        with open(PROVIDERS_FILE, encoding="utf-8") as f:
            data = json.load(f)
        for p in data.get("providers") or []:
            url = (p.get("api_url") or "") + (p.get("balance_url") or "")
            if "api.deepseek.com" not in url and p.get("name") != "deepseek":
                continue
            key = (p.get("api_key") or "").strip()
            if key:
                _key_cache["key"] = key
                _key_cache["ts"] = now
                return key
        raise RuntimeError("ai-providers.json 里找不到可用的 deepseek api_key")
    except Exception as exc:
        if _key_cache["key"]:
            log(f"读取密钥失败，沿用缓存值: {exc}")
            return _key_cache["key"]
        raise


def post_api(path: str, payload: dict, timeout: int) -> dict:
    key = get_api_key()
    req = urllib.request.Request(
        f"{API_BASE}/{path}",
        data=json.dumps(payload, ensure_ascii=False).encode("utf-8"),
        headers={
            "Authorization": f"Bearer {key}",
            "Content-Type": "application/json",
            "Accept": "application/json",
        },
    )
    try:
        with urllib.request.urlopen(req, timeout=timeout) as resp:
            return json.loads(resp.read().decode("utf-8"))
    except urllib.error.HTTPError as exc:
        detail = exc.read().decode("utf-8", "replace")[:400]
        raise RuntimeError(f"HTTP {exc.code}: {detail}") from None
    except urllib.error.URLError as exc:
        raise RuntimeError(f"网络错误: {exc.reason}") from None
    except json.JSONDecodeError:
        raise RuntimeError("上游返回非 JSON 内容") from None


def clip(text: str, max_chars: int, label: str) -> str:
    if not text:
        return ""
    if max_chars and max_chars > 0 and len(text) > max_chars:
        return f"{text[:max_chars]}…（已截断，原文 {len(text)} 字）"
    return text


# ===== 工具 =====
@mcp.tool(
    name="ds_search",
    description=(
        "用 DeepSeek 自研搜索引擎搜网页，返回标题、URL、摘要、权威度（0-4，>=3 为高权威）。"
        "支持 site: / -site: / 引号语法。摘要通常够回答问题；确实需要正文时把 need_content "
        "设为 true，一次拿全，比再调 ds_fetch 快一个数量级。多个独立目标并行搜，同一目标的"
        "多个关键词合并成一次调用。"
    ),
)
def ds_search(
    query: Annotated[str, Field(description="搜索词，1-128 字符。支持 site: / -site: / 引号短语")],
    count: Annotated[int, Field(description="返回条数，1-50", ge=1, le=50)] = 10,
    ori_question: Annotated[
        Optional[str], Field(description="触发本次搜索的用户原始问题，1-128 字符，可提升意图理解")
    ] = None,
    need_content: Annotated[
        bool, Field(description="是否在结果里直接返回网页正文（默认 false，只在需要原文时开）")
    ] = False,
    localization: Annotated[
        Optional[str], Field(description="用于优先返回本地化结果的 IP 地址，一般留空")
    ] = None,
    max_chars: Annotated[
        int, Field(description="每条摘要/正文的字符上限，0 表示不截断", ge=0)
    ] = 0,
) -> str:
    payload = {"query": query, "count": count, "need_content": need_content}
    if ori_question:
        payload["ori_question"] = ori_question
    if localization:
        payload["localization"] = localization
    started = time.time()
    try:
        data = post_api("search", payload, SEARCH_TIMEOUT)
    except RuntimeError as exc:
        return f"错误：{exc}"
    elapsed = time.time() - started
    results = data.get("results") or []
    if not results:
        return f"未找到结果（query={query!r}，耗时 {elapsed:.2f}s）"
    lines = [f"共 {len(results)} 条结果（耗时 {elapsed:.2f}s）"]
    for i, it in enumerate(results, 1):
        lines.append("")
        lines.append(f"[{i}] {(it.get('title') or '').strip()}")
        lines.append(f"URL: {it.get('url') or ''}")
        lines.append(
            f"站点: {it.get('site_name') or '-'} | 权威度: {it.get('authority')} "
            f"| 日期: {it.get('date') or '-'}"
        )
        summary = clip((it.get("summary") or "").strip(), max_chars, "摘要")
        if summary:
            lines.append(f"摘要: {summary}")
        content = clip((it.get("content") or "").strip(), max_chars, "正文")
        if content:
            lines.append(f"正文: {content}")
    return "\n".join(lines)


@mcp.tool(
    name="ds_fetch",
    description=(
        "用 DeepSeek 抓单个网页，返回标题和 Markdown 正文。比 ds_search 返回的 content "
        "更完整，但夹带页面导航、评论区等杂音，且慢——公众号类页面实测 7 秒以上。"
        "只在 ds_search 的摘要不足以作答时才调用。"
    ),
)
def ds_fetch(
    url: Annotated[str, Field(description="要抓取的网页地址，必须是 http/https 绝对 URL")],
    max_chars: Annotated[
        int, Field(description="正文字符上限，0 表示不截断", ge=0)
    ] = 0,
) -> str:
    if not url.lower().startswith(("http://", "https://")):
        return "错误：url 必须是 http:// 或 https:// 开头的绝对地址"
    started = time.time()
    try:
        data = post_api("fetch", {"url": url}, FETCH_TIMEOUT)
    except RuntimeError as exc:
        return f"错误：{exc}"
    elapsed = time.time() - started
    title = (data.get("title") or "").strip()
    content = (data.get("content") or "").strip()
    if not content:
        return f"抓取成功但正文为空（{elapsed:.2f}s）：{url}"
    head = f"标题: {title or '(无标题)'}\nURL: {url}\n正文（{len(content)} 字，耗时 {elapsed:.2f}s）:"
    return f"{head}\n{clip(content, max_chars, '正文')}"


# ===== Bearer 鉴权（ASGI 层，不干扰 SSE 流式响应）=====
class BearerAuth:
    def __init__(self, app, token: str):
        self.app = app
        self.token = token

    async def __call__(self, scope, receive, send):
        if scope.get("type") != "http":
            await self.app(scope, receive, send)
            return
        headers = {}
        for k, v in scope.get("headers") or []:
            headers[k.decode("latin-1").lower()] = v.decode("latin-1")
        if headers.get("authorization", "") != f"Bearer {self.token}":
            body = b'{"error":"unauthorized"}'
            await send(
                {
                    "type": "http.response.start",
                    "status": 401,
                    "headers": [
                        (b"content-type", b"application/json"),
                        (b"content-length", str(len(body)).encode()),
                    ],
                }
            )
            await send({"type": "http.response.body", "body": body})
            return
        await self.app(scope, receive, send)


def main() -> None:
    if not TOKEN:
        log("启动失败：环境变量 MCP_TOOLS_API_TOKEN 为空，拒绝以无鉴权方式启动")
        sys.exit(1)
    try:
        get_api_key()
        log("密钥读取成功（来源 ai-providers.json）")
    except Exception as exc:
        log(f"启动警告：暂时读不到 deepseek 密钥（{exc}），首次调用时会重试")
    app = BearerAuth(mcp.streamable_http_app(), TOKEN)
    log(f"ds-mcp 启动于 http://{HOST}:{PORT}/mcp")
    uvicorn.run(app, host=HOST, port=PORT, log_level="info")


if __name__ == "__main__":
    main()
