# ds-mcp · DeepSeek 搜索 MCP 服务

把 DeepSeek 自研搜索引擎的 Search / Fetch 两个接口封装成 MCP 工具。

- 监听：`127.0.0.1:8772`，路径 `/mcp`，只绑本机
- 协议：MCP Streamable HTTP（`mcp` SDK 1.28.1 自带 FastMCP）
- 鉴权：`Authorization: Bearer <MCP_TOOLS_API_TOKEN>`，token 由 `$PROJECT_ROOT/.env` 经 systemd `EnvironmentFile` 注入，与 8771 共用同一把
- 密钥：运行时从 `$PROJECT_ROOT/config/ai-providers.json` 读取
  （`api_url` 含 `api.deepseek.com` 或 `name == deepseek` 的 provider），本服务**不保存密钥副本**
- 进程：`ds-mcp.service`，`Restart=always`，`enabled` 开机自启
- 日志：`$PROJECT_ROOT/ds-mcp/ds_mcp.log`

## 工具

### ds_search

用 DeepSeek 自研引擎搜索，返回标题 / URL / 摘要 / 权威度。

| 参数 | 默认 | 说明 |
|---|---|---|
| `query` | 必填 | 1-128 字符，支持 `site:` / `-site:` / 引号短语 |
| `count` | 10 | 1-50 |
| `ori_question` | null | 触发搜索的原始问题，提升意图理解 |
| `need_content` | false | true 时结果直接带网页正文，省掉一次 ds_fetch |
| `localization` | null | 用于本地化排序的 IP，一般留空 |
| `max_chars` | 0 | 每条摘要/正文字符上限，0 不截断 |

### ds_fetch

抓单个网页，返回标题 + Markdown 正文。

| 参数 | 默认 | 说明 |
|---|---|---|
| `url` | 必填 | http/https 绝对 URL |
| `max_chars` | 0 | 正文字符上限，0 不截断 |

## 实测数据（2026-10-20）

| 场景 | 耗时 | 体积 |
|---|---|---|
| search count=3 need_content=false | 0.34s | 2.9 KB |
| search count=10 need_content=true | 0.43s | 30 KB（正文 17663 字） |
| fetch 普通网页 | 0.14s | 751 字 |
| fetch 微信公众号文章 | 7.54s | 6666 字 |

结论：
1. `need_content=true` 只比 false 多 0.09 秒，却省掉一次 fetch（7.5 秒）和一次计费，代价是 10 条约 3 万字符进上下文。默认 false，需要原文时显式开。
2. 公众号正文能正常抓取，但慢两个数量级。
3. `ds_search` 返回的 content 是清洗后的正文；`ds_fetch` 返回整页 Markdown，夹带导航和评论区尾巴。两者不能互相替代。
4. `authority` 字段分布 0-4，≥3 为高权威，可直接用于过滤低质源。

## 计费

Search 与 Fetch 均按**成功请求次数**计费，每 1000 次 5 元人民币。
Search 返回空列表、Fetch 非 200 或正文为空、请求超时，均不计费。结果条数不影响价格。

## 运维

```bash
systemctl status ds-mcp
systemctl restart ds-mcp
journalctl -u ds-mcp -n 50
tail -f $PROJECT_ROOT/ds-mcp/ds_mcp.log
```

改 `ai-providers.json` 里的 deepseek key 后无需重启服务，进程内缓存 60 秒自动刷新。

## 客户端接入

`config/mcp-servers.json` 已登记：

```json
{
  "id": "ds-mcp-local",
  "name": "DeepSeek搜索",
  "type": "streamable-http",
  "enabled": true,
  "url": "http://127.0.0.1:8772/mcp",
  "args": [],
  "headers": { "Authorization": "Bearer <MCP_TOOLS_API_TOKEN>" }
}
```

gateway 需要重启才读到新配置。

## 排查顺序

1. `systemctl is-active ds-mcp` —— 服务活着没
2. `curl -s -o /dev/null -w "%{http_code}" -X POST http://127.0.0.1:8772/mcp -H "Authorization: Bearer $TOKEN" -H "Content-Type: application/json" -H "Accept: application/json, text/event-stream" -d '{"jsonrpc":"2.0","id":1,"method":"tools/list"}'` —— 401 说明 token 不对，200 说明正常
3. `tail ds_mcp.log` —— 看有没有 `HTTP 401`（上游 key 失效）或 `网络错误`
4. 上游 key 是否还有余额：`config/ai-providers.json` 里的 `balance_url`
